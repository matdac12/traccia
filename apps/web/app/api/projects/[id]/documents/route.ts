import { ApiError, api } from "@/lib/api/client";

// Streams a multipart upload to `POST /v1/projects/:id/documents` with the server-side token. A route handler
// rather than a server action: the body is piped through and is not subject to the server-action body limit.
// (The API buffers it, up to 10 MiB, because `description` may follow the file part.) The API enforces size and
// type and its error shape comes back unchanged. proxy.ts covers this route like every other.

const PROJECT_REF = /^[A-Za-z0-9_-]{1,64}$/;

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!PROJECT_REF.test(id)) return error(404, "not_found", "Project not found");
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType) || !request.body) {
    return error(400, "validation_error", "Expected a multipart/form-data body");
  }
  let upstream: Response;
  try {
    upstream = await api().raw(`/projects/${encodeURIComponent(id)}/documents`, {
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
  // JSON passes through as is (created document or the standard error shape).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": type, "cache-control": "no-store" },
  });
}
