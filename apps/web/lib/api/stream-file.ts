import "server-only";
import { ApiError, api } from "@/lib/api/client";
import { ATTACHMENT_ID } from "@/lib/attachments";

// Streams a stored file from the API with the server-side token. The browser has no token, and the
// proxy.ts access check covers the routes that use this like every other. The body is piped, never buffered.
// The API does not serve Range requests, so neither do these routes.

const FORWARDED_HEADERS = ["content-type", "content-disposition"];

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

/** `apiPath` is the API-side path for the id (`root`: relative to the API root, not `/v1`). */
export async function serveFile(
  method: "GET" | "HEAD",
  id: string,
  signal: AbortSignal,
  { apiPath, root, noun }: { apiPath: (id: string) => string; root?: boolean; noun: string },
): Promise<Response> {
  if (!ATTACHMENT_ID.test(id)) return error(404, "not_found", `${noun} not found`);
  let upstream: Response;
  try {
    upstream = await api().raw(apiPath(id), { method, signal, root });
  } catch (err) {
    if (err instanceof ApiError) return error(502, err.code, "The API is unreachable");
    throw err;
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    // Only "not found" is the caller's to hear; any other failure is the API's problem, not theirs.
    if (upstream.status === 404) return error(404, "not_found", `${noun} not found`);
    return error(502, "upstream_error", `The API answered ${upstream.status}`);
  }
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // fetch() decodes a compressed body, so the API's length is only right for an identity encoding.
  const length = upstream.headers.get("content-length");
  if (length && !upstream.headers.get("content-encoding")) headers.set("content-length", length);
  // Files are untrusted uploads served from the dashboard's origin: no scripts, no embedding contexts.
  // Skipped for PDF: Chrome's built-in viewer does not run inside a CSP sandbox.
  if (!/^application\/pdf/i.test(headers.get("content-type") ?? "")) {
    headers.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  }
  // Always forced, whatever the API said: a served file must never be sniffed into something executable.
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, no-cache");
  return new Response(method === "HEAD" ? null : upstream.body, { status: 200, headers });
}
