import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { RequestListener } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSourceFetcher } from "../src/mcp/ssrf-fetch.js";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

const fixture = (n: string) =>
  readFileSync(path.join(import.meta.dirname, "fixtures", n));
const cert = fixture("test-cert.pem");
const key = fixture("test-key.pem");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(600, 7),
]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(700, 65)]);

const closers: Array<{ close(): void }> = [];
const clients: Client[] = [];
let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mcp-att-"));
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  for (const s of closers.splice(0)) s.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function start(
  env: Record<string, string> = {},
  fetcherOpts?: Parameters<typeof createSourceFetcher>[0],
) {
  const t = createTestApp(
    { DATA_DIR: dataDir, ...env },
    {
      fetchSource: createSourceFetcher({
        tls: { ca: cert },
        allowAnyPort: true,
        ...fetcherOpts,
      }),
    },
  );
  const services = createServices({ db: t.db, defaultIssueKey: "MAT" });
  const project = services.projects.create("you", { name: "P" });
  const issue = services.issues.create("agent", {
    project: project.id,
    title: "T",
  });
  const other = services.issues.create("agent", {
    project: project.id,
    title: "Other",
  });
  const { server, port } = await new Promise<{
    server: ReturnType<typeof serve>;
    port: number;
  }>((resolve) => {
    const server = serve(
      { fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" },
      (info: AddressInfo) => resolve({ server, port: info.port }),
    );
  });
  closers.push(server);
  const connect = async (actor: "agent" | "you") => {
    const tok = createToken(t.db, { name: actor, actor });
    const client = new Client({ name: "test", version: "0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${tok.token}` } } },
      ),
    );
    return client;
  };
  const call = async (
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ) =>
    (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }>;
      structuredContent?: Record<string, any>;
    };
  return { ...t, services, issue, other, connect, call };
}

const errText = (r: { content: Array<{ text?: string }> }) =>
  r.content.map((c) => c.text).join(" ");

describe("MCP attachment tools", () => {
  it("lists the three tools", async () => {
    const s = await start();
    const { tools } = await (await s.connect("agent")).listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "create_attachment",
        "get_attachment",
        "delete_attachment",
      ]),
    );
  });

  it("uploads a PNG as base64 and get_attachment returns an image block", async () => {
    const s = await start();
    const c = await s.connect("agent");
    const created = await s.call(c, "create_attachment", {
      issueId: s.issue.identifier,
      filename: "shot.png",
      contentBase64: PNG.toString("base64"),
    });
    expect(created.isError).toBeFalsy();
    const a = created.structuredContent!;
    expect(a).toMatchObject({
      filename: "shot.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
    });
    expect(a.url).toBe(`http://localhost:8787/files/${a.id}`);
    expect(a.markdown).toBe(`![shot.png](${a.url})`);

    const got = await s.call(c, "get_attachment", { id: a.id });
    expect(got.structuredContent).toMatchObject({
      id: a.id,
      mimeType: "image/png",
    });
    expect(got.structuredContent).not.toHaveProperty("storageKey");
    const image = got.content.find((x) => x.type === "image");
    expect(image?.mimeType).toBe("image/png");
    expect(Buffer.from(image!.data!, "base64").equals(PNG)).toBe(true);

    const meta = await s.call(c, "get_attachment", {
      id: a.id,
      includeContent: false,
    });
    expect(meta.content.some((x) => x.type === "image")).toBe(false);
  });

  it("writes attributed to the token's actor and records activity", async () => {
    const s = await start();
    const c = await s.connect("you");
    const r = await s.call(c, "create_attachment", {
      issueId: s.issue.id,
      filename: "a.pdf",
      contentBase64: PDF.toString("base64"),
    });
    expect(r.structuredContent!.markdown).toBe(
      `[a.pdf](${r.structuredContent!.url})`,
    );
    expect(s.services.attachments.get(r.structuredContent!.id).actor).toBe(
      "you",
    );
  });

  it("attaches to a comment of the same issue and rejects another issue's", async () => {
    const s = await start();
    const c = await s.connect("agent");
    const mine = s.services.comments.create("agent", s.issue.identifier, {
      body: "hi",
    });
    const theirs = s.services.comments.create("agent", s.other.identifier, {
      body: "hi",
    });
    const ok = await s.call(c, "create_attachment", {
      issueId: s.issue.identifier,
      commentId: mine.id,
      filename: "a.png",
      contentBase64: PNG.toString("base64"),
    });
    expect(ok.structuredContent!.id).toBeTruthy();
    const bad = await s.call(c, "create_attachment", {
      issueId: s.issue.identifier,
      commentId: theirs.id,
      filename: "a.png",
      contentBase64: PNG.toString("base64"),
    });
    expect(bad.isError).toBe(true);
    // the rejected upload must not leave a file behind
    const files = await readdir(path.join(dataDir, "attachments"), {
      recursive: true,
      withFileTypes: true,
    });
    expect(files.filter((f) => f.isFile())).toHaveLength(1);
  });

  describe("argument validation", () => {
    it("requires exactly one of contentBase64 / sourceUrl", async () => {
      const s = await start();
      const c = await s.connect("agent");
      const base = { issueId: s.issue.identifier, filename: "a.png" };
      for (const extra of [
        {},
        {
          contentBase64: PNG.toString("base64"),
          sourceUrl: "https://example.com/a.png",
        },
      ]) {
        const r = await s.call(c, "create_attachment", { ...base, ...extra });
        expect(r.isError).toBe(true);
        expect(errText(r)).toMatch(/exactly one of contentBase64 or sourceUrl/);
      }
    });

    it("rejects oversize base64", async () => {
      const s = await start({ MAX_MCP_UPLOAD_BYTES: "1024" });
      const c = await s.connect("agent");
      const r = await s.call(c, "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        contentBase64: Buffer.concat([PNG, Buffer.alloc(2000)]).toString(
          "base64",
        ),
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/exceeds the 1024 byte limit/);
    });

    it.each([
      ["not base64!!", /not valid base64/],
      ["QUJD=QUJD", /not valid base64/],
    ])("rejects malformed base64 %s", async (contentBase64, re) => {
      const s = await start();
      const r = await s.call(await s.connect("agent"), "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        contentBase64,
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(re);
    });

    it("rejects a type mismatch and unsupported types", async () => {
      const s = await start();
      const c = await s.connect("agent");
      const mismatch = await s.call(c, "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        mimeType: "image/png",
        contentBase64: PDF.toString("base64"),
      });
      expect(mismatch.isError).toBe(true);
      expect(errText(mismatch)).toMatch(/does not match declared type/);
      expect(errText(mismatch)).toContain("detected application/pdf");
      const html = await s.call(c, "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("<html><script>x</script>").toString(
          "base64",
        ),
      });
      expect(html.isError).toBe(true);
      const exe = await s.call(c, "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.bin",
        contentBase64: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]).toString(
          "base64",
        ),
      });
      expect(exe.isError).toBe(true);
      expect(errText(exe)).toMatch(/Unsupported file type/);
    });

    it("rejects an unknown issue", async () => {
      const s = await start();
      const r = await s.call(await s.connect("agent"), "create_attachment", {
        issueId: "MAT-9999",
        filename: "a.png",
        contentBase64: PNG.toString("base64"),
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/not found/);
    });
  });

  describe("sourceUrl", () => {
    async function origin(handler: RequestListener) {
      const server = https.createServer({ cert, key }, handler);
      closers.push(server);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      return `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    it("is blocked in the production default (loopback)", async () => {
      const s = await start();
      const url = await origin((_q, res) => res.end(PNG));
      const r = await s.call(await s.connect("agent"), "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        sourceUrl: `${url}/a.png`,
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/private, loopback, link-local or metadata/);
    });

    it("works when the address is explicitly allowed", async () => {
      const s = await start({}, { allowedAddresses: ["127.0.0.1"] });
      const url = await origin((_q, res) => {
        res.setHeader("Content-Type", "image/png");
        res.end(PNG);
      });
      const c = await s.connect("agent");
      const r = await s.call(c, "create_attachment", {
        issueId: s.issue.identifier,
        filename: "remote.png",
        sourceUrl: `${url}/a.png`,
      });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({
        mimeType: "image/png",
        sizeBytes: PNG.length,
      });
      const got = await s.call(c, "get_attachment", {
        id: r.structuredContent!.id,
      });
      expect(got.content.some((x) => x.type === "image")).toBe(true);
    });

    it("sniffs against the server's Content-Type and rejects a lie", async () => {
      const s = await start({}, { allowedAddresses: ["127.0.0.1"] });
      const url = await origin((_q, res) => {
        res.setHeader("Content-Type", "image/png");
        res.end(PDF);
      });
      const r = await s.call(await s.connect("agent"), "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        sourceUrl: `${url}/x`,
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/does not match declared type/);
    });

    it("hints at mimeType when Content-Type is generic, and accepts it", async () => {
      const s = await start({}, { allowedAddresses: ["127.0.0.1"] });
      const url = await origin((_q, res) => {
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(PNG);
      });
      const c = await s.connect("agent");
      const args = {
        issueId: s.issue.identifier,
        filename: "a.png",
        sourceUrl: `${url}/x`,
      };
      const r = await s.call(c, "create_attachment", args);
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/pass mimeType/);
      const ok = await s.call(c, "create_attachment", {
        ...args,
        mimeType: "image/png",
      });
      expect(ok.isError).toBeFalsy();
    });

    it("rejects an oversize download (streamed, no Content-Length)", async () => {
      const s = await start(
        { MAX_ATTACHMENT_BYTES: "1024" },
        { allowedAddresses: ["127.0.0.1"] },
      );
      const url = await origin((_q, res) => {
        res.setHeader("Content-Type", "image/png");
        res.write(PNG.subarray(0, 600));
        res.end(Buffer.alloc(4000));
      });
      const r = await s.call(await s.connect("agent"), "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        sourceUrl: `${url}/x`,
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/exceeds the 1024 byte limit/);
      const dir = path.join(dataDir, "attachments");
      if (existsSync(dir)) {
        const files = await readdir(dir, {
          recursive: true,
          withFileTypes: true,
        });
        expect(files.filter((f) => f.isFile())).toHaveLength(0);
      }
    });

    it.each([
      "https://127.0.0.1/a.png",
      "https://localhost/a.png",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/a.png",
      "https://[::ffff:127.0.0.1]/a.png",
      "http://example.com/a.png",
    ])("rejects %s with an actionable error", async (sourceUrl) => {
      const s = await start();
      const r = await s.call(await s.connect("agent"), "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        sourceUrl,
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/sourceUrl (rejected|must use https)/);
    });

    it("rejects a hostname resolving to a private IP", async () => {
      const s = await start(
        {},
        { resolve: async () => [{ address: "10.1.2.3", family: 4 }] },
      );
      const r = await s.call(await s.connect("agent"), "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        sourceUrl: "https://intranet.example.test/a.png",
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/private, loopback/);
    });

    it("rejects a public-looking URL that redirects to a private IP", async () => {
      const s = await start(
        {},
        {
          allowedAddresses: ["127.0.0.1"],
          resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        },
      );
      const url = await origin((_q, res) => {
        res
          .writeHead(302, {
            Location: "https://169.254.169.254/latest/meta-data/",
          })
          .end();
      });
      const port = new URL(url).port;
      const r = await s.call(await s.connect("agent"), "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        sourceUrl: `https://files.example.test:${port}/a.png`,
      });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/private, loopback, link-local or metadata/);
    });
  });

  describe("delete_attachment", () => {
    async function uploaded(s: Awaited<ReturnType<typeof start>>, c: Client) {
      const r = await s.call(c, "create_attachment", {
        issueId: s.issue.identifier,
        filename: "a.png",
        contentBase64: PNG.toString("base64"),
      });
      return r.structuredContent!.id as string;
    }

    it("soft-deletes, after which get is not found", async () => {
      const s = await start();
      const c = await s.connect("agent");
      const id = await uploaded(s, c);
      const r = await s.call(c, "delete_attachment", { id });
      expect(r.structuredContent).toEqual({ id, deleted: true, purged: false });
      const got = await s.call(c, "get_attachment", { id });
      expect(got.isError).toBe(true);
      expect(errText(got)).toMatch(/not found/);
    });

    it("refuses purge for an agent unless ALLOW_AGENT_PURGE", async () => {
      const s = await start();
      const c = await s.connect("agent");
      const id = await uploaded(s, c);
      await s.call(c, "delete_attachment", { id });
      const r = await s.call(c, "delete_attachment", { id, purge: true });
      expect(r.isError).toBe(true);
      expect(errText(r)).toMatch(/Agents cannot purge by default/);
    });

    it("purges a deleted attachment and its file for 'you'", async () => {
      const s = await start();
      const c = await s.connect("you");
      const id = await uploaded(s, c);
      const live = await s.call(c, "delete_attachment", { id, purge: true });
      expect(live.isError).toBe(true);
      expect(errText(live)).toMatch(/must be deleted before/);
      await s.call(c, "delete_attachment", { id });
      const r = await s.call(c, "delete_attachment", { id, purge: true });
      expect(r.structuredContent).toEqual({ id, deleted: true, purged: true });
      const files = await readdir(path.join(dataDir, "attachments"), {
        recursive: true,
        withFileTypes: true,
      });
      expect(files.filter((f) => f.isFile())).toHaveLength(0);
    });

    it("allows agent purge when configured", async () => {
      const s = await start({ ALLOW_AGENT_PURGE: "true" });
      const c = await s.connect("agent");
      const id = await uploaded(s, c);
      await s.call(c, "delete_attachment", { id });
      const r = await s.call(c, "delete_attachment", { id, purge: true });
      expect(r.structuredContent?.purged).toBe(true);
    });
  });
});
