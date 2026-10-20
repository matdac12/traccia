import "server-only";
import { createHash } from "node:crypto";

/**
 * `Response.json(data)` for a route the page polls, with a strong `ETag` (a hash of the body). A request whose
 * `If-None-Match` has it gets a 304 with no body. `no-cache` makes the browser ask every time and hand the page its
 * kept copy on a 304, so an unchanged poll sends nothing and the page has nothing to compare.
 */
export function jsonWithEtag(request: Request, data: unknown): Response {
  const body = JSON.stringify(data);
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers = { ETag: etag, "Cache-Control": "no-cache" };
  const sent = request.headers.get("if-none-match");
  if (sent && (sent.trim() === "*" || sent.split(",").some((t) => t.trim().replace(/^W\//, "") === etag))) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
}
