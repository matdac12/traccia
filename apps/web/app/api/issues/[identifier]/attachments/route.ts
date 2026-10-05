import { ApiError, api } from "@/lib/api/client";

// Streams a multipart upload to `POST /v1/issues/:identifier/attachments` with the server-side token.
// A route handler rather than a server action: the file is piped through without being buffered and
// is not subject to the server-action body limit. The API enforces size and type and its error
// shape comes back unchanged. proxy.ts covers this route like every other.

const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, ctx: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await ctx.params;
  if (!IDENTIFIER.test(identifier)) return error(404, "not_found", "Issue not found");
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType) || !request.body) {
    return error(400, "validation_error", "Expected a multipart/form-data body");
  }
  let upstream: Response;
  try {
    upstream = await api().raw(`/issues/${encodeURIComponent(identifier)}/attachments`, {
      method: "POST",
      headers: { "content-type": contentType, accept: "application/json" },
      body: request.body,
      signal: request.signal,
    });
  } catch (err) {
    if (err instanceof ApiError) return error(502, err.code, "Could not reach the API.");
    throw err;
  }
  const type = upstream.headers.get("content-type") ?? "";
  if (!type.includes("json") || upstream.status >= 500 || upstream.status === 401) {
    await upstream.body?.cancel();
    return error(502, "upstream_error", `The API answered ${upstream.status}`);
  }
  // JSON passes through as is (created attachment or the standard error shape).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": type, "cache-control": "no-store" },
  });
}
