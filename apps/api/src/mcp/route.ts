import path from "node:path";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAuth } from "../auth/middleware.js";
import { bearerChallenge } from "../auth/oauth-metadata.js";
import { createBearerVerifier } from "../auth/verifier.js";
import type { AppContainer, AppEnv } from "../rest/env.js";
import { type AttachmentStorage, LocalDiskStorage } from "../storage/index.js";
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
      const response = await transport.handleRequest(c.req.raw);
      // Stateless: nothing outlives the request.
      void server.close();
      return response;
    },
  );

  return mcp;
}
