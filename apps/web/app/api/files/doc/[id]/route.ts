import { serveFile } from "@/lib/api/stream-file";

// Streams a project document (see lib/api/stream-file.ts). The API serves it at `/files/doc/:id`, outside `/v1`.
const options = { apiPath: (id: string) => `/files/doc/${id}`, root: true, noun: "Document" };

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return serveFile("GET", (await ctx.params).id, request.signal, options);
}

export async function HEAD(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return serveFile("HEAD", (await ctx.params).id, request.signal, options);
}
