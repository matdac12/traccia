import { Hono } from "hono";
import type { AppEnv } from "../rest/env.js";

const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";

/** Everything advertised here derives from `OAUTH_PUBLIC_URL`, or `BASE_URL` when that is unset; nothing is hard-coded. */
export function oauthUrls(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    issuer: base,
    resource: `${base}/mcp`,
    resourceMetadata: `${base}${PROTECTED_RESOURCE_PATH}`,
    authorizationEndpoint: `${base}/authorize`,
    tokenEndpoint: `${base}/token`,
    registrationEndpoint: `${base}/register`,
  };
}

/** The `WWW-Authenticate` value that points clients at the resource metadata. */
export function bearerChallenge(baseUrl: string): string {
  return `Bearer resource_metadata="${oauthUrls(baseUrl).resourceMetadata}"`;
}

/**
 * OAuth discovery documents (RFC 9728 protected resource, RFC 8414
 * authorization server). The endpoints they advertise live in
 * `oauth-server.ts`.
 */
export function createOAuthMetadataRoutes(baseUrl: string) {
  const urls = oauthUrls(baseUrl);
  const routes = new Hono<AppEnv>();

  // Public documents: browser-based MCP clients fetch them cross-origin.
  // Scoped: routes are merged into the app, so a bare "*" would also stamp
  // public caching and CORS onto /token and the rest.
  routes.use("/.well-known/*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "public, max-age=300");
  });

  const protectedResource = {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    bearer_methods_supported: ["header"],
  };
  // RFC 9728 inserts the well-known segment before the resource's path, so
  // clients may ask for either form.
  routes.get(PROTECTED_RESOURCE_PATH, (c) => c.json(protectedResource));
  routes.get(`${PROTECTED_RESOURCE_PATH}/mcp`, (c) =>
    c.json(protectedResource),
  );

  routes.get(AUTHORIZATION_SERVER_PATH, (c) =>
    c.json({
      issuer: urls.issuer,
      authorization_endpoint: urls.authorizationEndpoint,
      token_endpoint: urls.tokenEndpoint,
      registration_endpoint: urls.registrationEndpoint,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    }),
  );

  return routes;
}
