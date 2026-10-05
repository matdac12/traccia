import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppEnv } from "../rest/env.js";
import { errorHandler } from "../rest/errors.js";
import {
  exchangeAuthCode,
  findClient,
  issueAuthCode,
  OAuthError,
  refreshGrant,
  registerClient,
  secretsMatch,
} from "../service/oauth.js";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_CLIENT_NAME = 100;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const oauthJson = (c: { header: (n: string, v: string) => void }) => {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
};

const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(MAX_CLIENT_NAME).optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .optional(),
  response_types: z.array(z.literal("code")).optional(),
});

const authorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2048).optional(),
});

type AuthorizeParams = z.infer<typeof authorizeSchema>;

const consentHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http:; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
};

function page(body: string, status: 200 | 400 | 403 = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Traccia</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:4rem auto;padding:0 1rem}
input[type=password]{width:100%;padding:.5rem;box-sizing:border-box}button{padding:.5rem 1rem;margin-right:.5rem}
.err{color:#b00020}code{word-break:break-all}</style></head><body>${body}</body></html>`;
  return new Response(html, { status, headers: consentHeaders });
}

function consentPage(
  clientName: string,
  p: AuthorizeParams,
  error?: string,
): Response {
  const hidden = Object.entries(p)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(String(v))}">`,
    )
    .join("");
  return page(
    `<h1>Authorize access</h1>
<p><strong>${escapeHtml(clientName)}</strong> wants to read and write your Traccia issues as the <code>agent</code> actor.</p>
<p>It will be redirected to <code>${escapeHtml(p.redirect_uri)}</code>.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<form method="post">${hidden}
<p><label>Admin secret<br><input type="password" name="admin_secret" autocomplete="current-password" autofocus></label></p>
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny" formnovalidate>Deny</button>
</form>`,
    error ? 403 : 200,
  );
}

const errorPage = (message: string) =>
  page(
    `<h1>Cannot authorize</h1><p class="err">${escapeHtml(message)}</p>`,
    400,
  );

function redirectWith(
  redirectUri: string,
  params: Record<string, string | undefined>,
): Response {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
}

/**
 * The OAuth authorization server behind the endpoints advertised by
 * `oauth-metadata.ts`: dynamic client registration (RFC 7591), authorize with
 * a minimal consent page, and token (code + rotating refresh), PKCE S256 only.
 *
 * Each endpoint is its own handler so route-level middleware (rate limiting,
 * lockout) can be added per route without touching the logic.
 */
export function createOAuthServerRoutes() {
  const routes = new Hono<AppEnv>();

  routes.onError((err, c) => {
    if (err instanceof OAuthError) {
      oauthJson(c);
      return c.json(
        { error: err.error, error_description: err.message },
        err.status as 400 | 401,
      );
    }
    return errorHandler(err, c);
  });

  // Off until an admin secret is configured: nobody could approve anything.
  const requireEnabled = (path: string) =>
    routes.use(path, async (c, next) => {
      if (!c.get("container").config.oauthAdminSecret) {
        oauthJson(c);
        return c.json(
          {
            error: "temporarily_unavailable",
            error_description: "OAuth is not enabled on this server",
          },
          503,
        );
      }
      await next();
    });
  for (const path of ["/register", "/authorize", "/token"]) {
    requireEnabled(path);
  }

  routes.post(
    "/register",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "invalid_client_metadata" }, 413),
    }),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = registrationSchema.safeParse(body);
      if (!parsed.success) {
        throw new OAuthError(
          "invalid_client_metadata",
          "Invalid client metadata: expect JSON with redirect_uris (and optionally client_name; token_endpoint_auth_method must be none)",
        );
      }
      const client = registerClient(c.get("container").db, {
        name: parsed.data.client_name ?? "MCP client",
        redirectUris: parsed.data.redirect_uris,
      });
      oauthJson(c);
      return c.json(
        {
          client_id: client.id,
          client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
          client_name: client.name,
          redirect_uris: client.redirectUris,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
        201,
      );
    },
  );

  /**
   * Validates the authorization request. The client and redirect URI are
   * checked first and failures there render an error page, never a redirect;
   * every later failure redirects back to the (now trusted) redirect URI.
   */
  function parseAuthorize(
    c: { get: (k: "container") => AppEnv["Variables"]["container"] },
    raw: Record<string, unknown>,
  ):
    | { ok: true; params: AuthorizeParams; clientName: string }
    | { ok: false; response: Response } {
    const container = c.get("container");
    const clientId = typeof raw.client_id === "string" ? raw.client_id : "";
    const redirectUri =
      typeof raw.redirect_uri === "string" ? raw.redirect_uri : "";
    const client = clientId ? findClient(container.db, clientId) : null;
    if (!client) return { ok: false, response: errorPage("Unknown client.") };
    if (!client.redirectUris.includes(redirectUri)) {
      return {
        ok: false,
        response: errorPage("redirect_uri is not registered for this client."),
      };
    }
    const state = typeof raw.state === "string" ? raw.state : undefined;
    const parsed = authorizeSchema.safeParse(raw);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "request");
      const error =
        field === "response_type"
          ? "unsupported_response_type"
          : "invalid_request";
      return {
        ok: false,
        response: redirectWith(redirectUri, {
          error,
          error_description:
            field === "code_challenge_method"
              ? "code_challenge_method must be S256"
              : `Invalid ${field}`,
          state,
        }),
      };
    }
    return { ok: true, params: parsed.data, clientName: client.name };
  }

  routes.get("/authorize", (c) => {
    const result = parseAuthorize(c, c.req.query());
    if (!result.ok) return result.response;
    return consentPage(result.clientName, result.params);
  });

  routes.post(
    "/authorize",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => errorPage("Request too large."),
    }),
    async (c) => {
      const form = await c.req.parseBody();
      const result = parseAuthorize(c, form);
      if (!result.ok) return result.response;
      const { params, clientName } = result;

      if (form.decision === "deny") {
        return redirectWith(params.redirect_uri, {
          error: "access_denied",
          state: params.state,
        });
      }
      const container = c.get("container");
      const presented =
        typeof form.admin_secret === "string" ? form.admin_secret : "";
      const expected = container.config.oauthAdminSecret ?? "";
      if (!expected || !secretsMatch(presented, expected)) {
        return consentPage(clientName, params, "Wrong admin secret.");
      }
      const code = issueAuthCode(container.db, {
        clientId: params.client_id,
        redirectUri: params.redirect_uri,
        codeChallenge: params.code_challenge,
      });
      return redirectWith(params.redirect_uri, { code, state: params.state });
    },
  );

  routes.post(
    "/token",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "invalid_request" }, 413),
    }),
    async (c) => {
      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.includes("application/x-www-form-urlencoded")) {
        throw new OAuthError(
          "invalid_request",
          "Content-Type must be application/x-www-form-urlencoded",
        );
      }
      const form = await c.req.parseBody();
      const field = (name: string) => {
        const v = form[name];
        return typeof v === "string" && v !== "" ? v : undefined;
      };
      const need = (name: string) => {
        const v = field(name);
        if (v === undefined) {
          throw new OAuthError("invalid_request", `Missing ${name}`);
        }
        return v;
      };

      const db = c.get("container").db;
      const grantType = need("grant_type");
      if (grantType !== "authorization_code" && grantType !== "refresh_token") {
        throw new OAuthError(
          "unsupported_grant_type",
          "grant_type must be authorization_code or refresh_token",
        );
      }
      const clientId = need("client_id");
      if (!findClient(db, clientId)) {
        throw new OAuthError("invalid_client", "Unknown client", 401);
      }

      const response =
        grantType === "authorization_code"
          ? exchangeAuthCode(db, {
              code: need("code"),
              clientId,
              redirectUri: need("redirect_uri"),
              codeVerifier: need("code_verifier"),
            })
          : refreshGrant(db, {
              refreshToken: need("refresh_token"),
              clientId,
            });
      oauthJson(c);
      return c.json(response);
    },
  );

  return routes;
}
