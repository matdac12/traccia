import path from "node:path";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAuth } from "../auth/middleware.js";
import { bearerChallenge } from "../auth/oauth-metadata.js";
import { createBearerVerifier } from "../auth/verifier.js";
import type { LogFields } from "../logger.js";
import type { AppContainer, AppEnv } from "../rest/env.js";
import { type AttachmentStorage, LocalDiskStorage } from "../storage/index.js";
import {
  describeCalls,
  headerForLog,
  readErrorDetail,
  serverTiming,
} from "./observe.js";
import { createMcpServer } from "./server.js";
import { createSourceFetcher, type SourceFetcher } from "./ssrf-fetch.js";

/** Room for the JSON-RPC envelope around a base64 upload. */
const ENVELOPE_BYTES = 64 * 1024;

/** Largest request body: the base64 form of the upload cap plus the envelope. */
export function mcpBodyLimit(maxMcpUploadBytes: number): number {
  return Math.ceil((maxMcpUploadBytes * 4) / 3) + ENVELOPE_BYTES;
}

/**
 * `POST /mcp`: stateless Streamable HTTP. Every request gets a fresh server
 * and transport, and replies with plain JSON (no SSE). GET and DELETE are
 * 405 because there is no stream to open and no session to end.
 */
export function createMcpRoute(
  container: AppContainer,
  deps: { storage?: AttachmentStorage; fetchSource?: SourceFetcher } = {},
) {
  const { config, db } = container;
  const attachments = {
    storage:
      deps.storage ??
      new LocalDiskStorage(path.join(config.dataDir, "attachments")),
    fetchSource:
      deps.fetchSource ??
      createSourceFetcher({ extraPorts: config.sourceUrlExtraPorts }),
  };
  const maxBytes = mcpBodyLimit(config.maxMcpUploadBytes);
  const mcp = new Hono<AppEnv>();

  mcp.on(["GET", "DELETE"], "/", (c) => c.body(null, 405, { Allow: "POST" }));

  mcp.post(
    "/",
    // Outermost: adds the MCP detail to the request log line, and for 4xx
    // (including auth and size rejections) the error code, message, protocol
    // version and user agent. Never reads the request body.
    async (c, next) => {
      await next();
      const fields: LogFields = { ...c.get("logFields") };
      if (c.res.status >= 400 && c.res.status < 500) {
        Object.assign(fields, await readErrorDetail(c.res));
        fields.protocolVersion = headerForLog(
          c.req.header("mcp-protocol-version"),
        );
        fields.userAgent = headerForLog(c.req.header("user-agent"));
      }
      c.set("logFields", fields);
    },
    // Set before auth so a thrown 401 carries it; cleared again on success.
    async (c, next) => {
      c.header(
        "WWW-Authenticate",
        bearerChallenge(config.oauthPublicUrl ?? config.baseUrl),
      );
      await next();
    },
    requireAuth({
      verify: createBearerVerifier(db),
      db,
      rateLimitPerMin: config.rateLimitPerMin,
      rateLimitYouPerMin: config.rateLimitYouPerMin,
    }),
    bodyLimit({
      maxSize: maxBytes,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "validation_error",
              message: `Request body exceeds ${maxBytes} bytes`,
              details: { maxBytes },
            },
          },
          413,
        ),
    }),
    async (c) => {
      c.header("WWW-Authenticate", undefined);
      // Peek at the (already size-limited) body for the method and tool name,
      // then hand the transport the parsed message, or a fresh request with
      // the same bytes when it is not JSON so the transport reports the error.
      const text = await c.req.text();
      let parsed: unknown;
      let parseFailed = false;
      try {
        parsed = JSON.parse(text);
      } catch {
        parseFailed = true;
      }
      const { count, calls } = parseFailed
        ? { count: 0, calls: [] }
        : describeCalls(parsed);
      const started = performance.now();
      const server = createMcpServer(
        {
          container,
          actor: c.get("actor"),
          tokenName: c.get("tokenName"),
        },
        { attachments },
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: maxBytes,
      });
      await server.connect(transport);
      const response = await transport.handleRequest(
        parseFailed
          ? new Request(c.req.raw.url, {
              method: "POST",
              headers: c.req.raw.headers,
              body: text,
            })
          : c.req.raw,
        parseFailed ? undefined : { parsedBody: parsed },
      );
      // Stateless: nothing outlives the request.
      void server.close();
      const ms = performance.now() - started;
      c.set("logFields", {
        mcpCalls: calls,
        mcpCount: count,
        mcpMs: Math.round(ms * 10) / 10,
      });
      response.headers.set("Server-Timing", serverTiming(ms, calls, count));
      return response;
    },
  );

  return mcp;
}
