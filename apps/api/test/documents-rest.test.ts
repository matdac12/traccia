import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(600, 7),
]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(700, 65)]);

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "doc-rest-"));
});
afterEach(() => rm(dataDir, { recursive: true, force: true }));

function setup() {
  const t = createTestApp({ DATA_DIR: dataDir });
  const services = createServices({ db: t.db, defaultIssueKey: "MAT" });
  const project = services.projects.create("you", { name: "P" });
  const agent = createToken(t.db, { name: "a", actor: "agent" });
  const auth = { Authorization: `Bearer ${agent.token}` };
  const upload = (
    data: Buffer | string,
    opts: {
      type?: string;
      name?: string;
      description?: string;
      ref?: string;
      headers?: object;
    } = {},
  ) => {
    const form = new FormData();
    if (opts.description !== undefined)
      form.append("description", opts.description);
    form.append(
      "file",
      new Blob([data as BlobPart], { type: opts.type ?? "application/pdf" }),
      opts.name ?? "spec.pdf",
    );
    return t.app.request(`/v1/projects/${opts.ref ?? project.id}/documents`, {
      method: "POST",
      body: form,
      headers: (opts.headers ?? auth) as HeadersInit,
    });
  };
  const json = (method: string, p: string, body?: unknown) =>
    t.app.request(p, {
      method,
      headers: {
        ...auth,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return { ...t, project, auth, upload, json, agent };
}

describe("documents REST", () => {
  it("requires a token", async () => {
    const { app, project } = setup();
    for (const [m, p] of [
      ["GET", `/v1/projects/${project.id}/documents`],
      ["POST", `/v1/projects/${project.id}/documents`],
      ["GET", "/v1/documents/x"],
      ["PATCH", "/v1/documents/x"],
      ["DELETE", "/v1/documents/x"],
      ["GET", "/files/doc/x"],
    ]) {
      expect((await app.request(p as string, { method: m })).status).toBe(401);
    }
  });

  it("uploads, returns url + markdown, never storageKey, and downloads", async () => {
    const { upload, json, app, auth, agent } = setup();
    const res = await upload(PDF, {
      description: "the spec",
      name: "my spec.pdf",
    });
    expect(res.status).toBe(201);
    const doc = (await res.json()) as any;
    expect(doc).toMatchObject({
      filename: "my spec.pdf",
      mimeType: "application/pdf",
      description: "the spec",
      sizeBytes: PDF.length,
      url: `http://localhost:8787/files/doc/${doc.id}`,
      markdown: `[my spec.pdf](http://localhost:8787/files/doc/${doc.id})`,
    });
    expect(doc.storageKey).toBeUndefined();

    const got = (await (
      await json("GET", `/v1/documents/${doc.id}`)
    ).json()) as any;
    expect(got).toEqual(doc);
    const list = (await (
      await json("GET", `/v1/projects/${doc.projectId}/documents`)
    ).json()) as any;
    expect(list.items[0].url).toBe(doc.url);
    expect(list.items[0].storageKey).toBeUndefined();

    const dl = await app.request(`/files/doc/${doc.id}`, { headers: auth });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-disposition")).toMatch(
      /^inline; filename="my spec.pdf"/,
    );
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await dl.arrayBuffer()).equals(PDF)).toBe(true);

    const head = await app.request(`/files/doc/${doc.id}`, {
      method: "HEAD",
      headers: auth,
    });
    expect(head.headers.get("content-length")).toBe(String(PDF.length));
    // The token never shows up in a response body.
    expect(JSON.stringify(doc)).not.toContain(agent.token);
  });

  it("uses an image snippet for images and attachment disposition for non-pdf/image", async () => {
    const { upload, app, auth } = setup();
    const img = (await (
      await upload(PNG, { type: "image/png", name: "a.png" })
    ).json()) as any;
    expect(img.markdown).toBe(`![a.png](${img.url})`);
    const txt = (await (
      await upload("# hi\n", { type: "text/markdown", name: "n.md" })
    ).json()) as any;
    const dl = await app.request(`/files/doc/${txt.id}`, { headers: auth });
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("rejects bad uploads", async () => {
    const { upload, app, auth, project } = setup();
    expect((await upload(PNG, { type: "application/pdf" })).status).toBe(400);
    expect(
      (await upload("x", { type: "application/zip", name: "a.zip" })).status,
    ).toBe(400);
    expect((await upload(PDF, { ref: "nope" })).status).toBe(404);
    const big = await upload(
      Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]),
    );
    expect(big.status).toBe(400);
    expect(((await big.json()) as any).error.details.reason).toBe("too_large");
    const noFile = new FormData();
    noFile.append("description", "x");
    const r = await app.request(`/v1/projects/${project.id}/documents`, {
      method: "POST",
      body: noFile,
      headers: auth,
    });
    expect(r.status).toBe(400);
    const notMultipart = await app.request(
      `/v1/projects/${project.id}/documents`,
      {
        method: "POST",
        body: "{}",
        headers: { ...auth, "Content-Type": "application/json" },
      },
    );
    expect(notMultipart.status).toBe(400);
  });

  it("patches, detects stale writes, deletes, restores and purges", async () => {
    const { upload, json, app, auth } = setup();
    const doc = (await (await upload(PDF)).json()) as any;
    const patched = (await (
      await json("PATCH", `/v1/documents/${doc.id}`, {
        description: "new",
        filename: "b.pdf",
      })
    ).json()) as any;
    expect(patched).toMatchObject({ description: "new", filename: "b.pdf" });
    expect(patched.url).toBe(doc.url);

    const stale = await json("PATCH", `/v1/documents/${doc.id}`, {
      description: "z",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(stale.status).toBe(409);
    expect((await json("PATCH", `/v1/documents/${doc.id}`, {})).status).toBe(
      400,
    );

    expect(
      (await json("DELETE", `/v1/documents/${doc.id}?purge=true`)).status,
    ).toBe(409);
    const del = await json("DELETE", `/v1/documents/${doc.id}`);
    expect(await del.json()).toMatchObject({
      id: doc.id,
      deleted: true,
      purged: false,
    });
    expect((await json("GET", `/v1/documents/${doc.id}`)).status).toBe(404);
    expect(
      (await app.request(`/files/doc/${doc.id}`, { headers: auth })).status,
    ).toBe(404);

    const trash = (await (
      await json("GET", "/v1/trash?type=document")
    ).json()) as any;
    expect(trash.items.map((i: any) => i.id)).toEqual([doc.id]);
    expect(
      (await json("POST", "/v1/restore", { type: "document", id: doc.id }))
        .status,
    ).toBe(200);
    expect(
      (await app.request(`/files/doc/${doc.id}`, { headers: auth })).status,
    ).toBe(200);

    await json("DELETE", `/v1/documents/${doc.id}`);
    const purged = await json("DELETE", `/v1/documents/${doc.id}?purge=true`);
    expect(await purged.json()).toMatchObject({ purged: true });
    expect(
      (await app.request(`/files/doc/${doc.id}`, { headers: auth })).status,
    ).toBe(404);
  });
});
