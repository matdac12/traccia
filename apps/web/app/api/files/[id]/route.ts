import { ApiError, api } from "@/lib/api/client";
import { ATTACHMENT_ID } from "@/lib/attachments";

// Streams an attachment from the API with the server-side token. The browser has no token, and the
// proxy.ts access check covers this route like every other. The body is piped, never buffered.
// The API does not serve Range requests, so neither does this route.

const PASS = ["content-type", "content-disposition", "content-length", "x-content-type-options", "etag", "last-modified"];

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

async function serve(method: "GET" | "HEAD", id: string, signal: AbortSignal): Promise<Response> {
  if (!ATTACHMENT_ID.test(id)) return error(404, "not_found", "Attachment not found");
  let upstream: Response;
  try {
    upstream = await api().raw(`/files/${id}`, { method, signal });
  } catch (err) {
    if (err instanceof ApiError) return error(502, err.code, "The API is unreachable");
    throw err;
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    // Only "not found" is the caller's to hear; any other failure is the API's problem, not theirs.
    if (upstream.status === 404) return error(404, "not_found", "Attachment not found");
    return error(502, "upstream_error", `The API answered ${upstream.status}`);
  }
  const headers = new Headers();
  for (const name of PASS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Always forced, whatever the API said: a served file must never be sniffed into something executable.
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, no-cache");
  return new Response(method === "HEAD" ? null : upstream.body, { status: 200, headers });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return serve("GET", (await ctx.params).id, request.signal);
}

export async function HEAD(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return serve("HEAD", (await ctx.params).id, request.signal);
}
