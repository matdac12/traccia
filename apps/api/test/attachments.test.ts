import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activity, attachments } from "../src/db/schema.js";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

type Body = { error: { code: string; message: string; details: any } };

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(600, 7),
]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(700, 65)]);

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "att-rest-"));
});
afterEach(() => rm(dataDir, { recursive: true, force: true }));

function setup(env: Record<string, string> = {}) {
  const t = createTestApp({ DATA_DIR: dataDir, ...env });
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
  const agent = createToken(t.db, { name: "a", actor: "agent" });
  const you = createToken(t.db, { name: "y", actor: "you" });
  const auth = { Authorization: `Bearer ${agent.token}` };
  const authYou = { Authorization: `Bearer ${you.token}` };

  const upload = (
    ref: string,
    data: Buffer | string,
    opts: {
      type?: string;
      name?: string;
      commentId?: string;
      headers?: object;
    } = {},
  ) => {
    const form = new FormData();
    if (opts.commentId) form.append("comment_id", opts.commentId);
    form.append(
      "file",
      new Blob([data as BlobPart], { type: opts.type ?? "image/png" }),
      opts.name ?? "shot.png",
    );
    return t.app.request(`/v1/issues/${ref}/attachments`, {
      method: "POST",
      body: form,
      headers: (opts.headers ?? auth) as HeadersInit,
    });
  };
  const storedFiles = async () =>
    (
      await readdir(path.join(dataDir, "attachments"), {
        recursive: true,
        withFileTypes: true,
      }).catch(() => [])
    ).filter((e) => e.isFile());
  return { ...t, services, issue, other, auth, authYou, upload, storedFiles };
}

describe("upload and download", () => {
  it("keeps attachment URLs on BASE_URL when OAUTH_PUBLIC_URL is set", async () => {
    const { upload, issue } = setup({
      BASE_URL: "https://files.example.ts.net",
      OAUTH_PUBLIC_URL: "https://public.example.ts.net:8443",
    });
    const res = await upload(issue.identifier, PNG);
    expect(res.status).toBe(201);
    const meta = (await res.json()) as any;
    expect(meta.url).toBe(`https://files.example.ts.net/files/${meta.id}`);
  });

  it("round-trips a png with inline headers", async () => {
    const { app, upload, issue, auth } = setup();
    const res = await upload(issue.identifier, PNG);
    expect(res.status).toBe(201);
    const meta = (await res.json()) as any;
    expect(meta).toMatchObject({
      issueId: issue.id,
      filename: "shot.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      actor: "agent",
      commentId: null,
    });
    expect(meta.storageKey).toBeUndefined();
    expect(meta.url).toBe(`http://localhost:8787/files/${meta.id}`);

    for (const p of [`/files/${meta.id}`, `/v1/files/${meta.id}`]) {
      const dl = await app.request(p, { headers: auth });
      expect(dl.status).toBe(200);
      expect(dl.headers.get("content-type")).toBe("image/png");
      expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
      expect(dl.headers.get("content-disposition")).toMatch(/^inline;/);
      expect(Buffer.from(await dl.arrayBuffer()).equals(PNG)).toBe(true);
    }
  });

  it("round-trips a pdf inline", async () => {
    const { app, upload, issue, auth } = setup();
    const meta = (await (
      await upload(issue.identifier, PDF, {
        type: "application/pdf",
        name: "spec.pdf",
      })
    ).json()) as any;
    const dl = await app.request(`/files/${meta.id}`, { headers: auth });
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await dl.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("serves text and json as attachment", async () => {
    const { app, upload, issue, auth } = setup();
    for (const [data, type, name] of [
      ["hello world", "text/plain", "n.txt"],
      ['{"a":1}', "application/json", "d.json"],
    ] as const) {
      const meta = (await (
        await upload(issue.identifier, data, { type, name })
      ).json()) as any;
      const dl = await app.request(`/files/${meta.id}`, { headers: auth });
      expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(await dl.text()).toBe(data);
    }
  });

  it("encodes non-ascii filenames safely and supports HEAD", async () => {
    const { app, upload, issue, auth } = setup();
    const meta = (await (
      await upload(issue.identifier, PNG, { name: 'sch"ermata é.png' })
    ).json()) as any;
    const head = await app.request(`/files/${meta.id}`, {
      method: "HEAD",
      headers: auth,
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(PNG.length));
    expect(await head.text()).toBe("");
    const cd = head.headers.get("content-disposition") ?? "";
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).not.toMatch(/filename="[^"]*"[^;]*"/);
  });

  it("writes attachment_added activity and lists via include=attachments", async () => {
    const { upload, issue, db, services } = setup();
    const meta = (await (await upload(issue.identifier, PNG)).json()) as any;
    const rows = db
      .select()
      .from(activity)
      .where(eq(activity.issueId, issue.id))
      .all()
      .filter((a) => a.type === "attachment_added");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.data ?? "{}").attachmentId).toBe(meta.id);
    const detail = services.issues.get(issue.identifier, ["attachments"]);
    expect(detail.attachments.map((a) => a.id)).toEqual([meta.id]);
    expect(services.issues.get(issue.identifier).attachments).toEqual([]);
  });
});

describe("metadata and delete", () => {
  it("gets metadata, soft deletes, keeps the file, 404s download", async () => {
    const { app, upload, issue, auth, storedFiles, db } = setup();
    const meta = (await (await upload(issue.identifier, PNG)).json()) as any;
    const get = await app.request(`/v1/attachments/${meta.id}`, {
      headers: auth,
    });
    expect(get.status).toBe(200);

    const del = await app.request(`/v1/attachments/${meta.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(del.status).toBe(200);
    expect(await storedFiles()).toHaveLength(1);
    const row = db
      .select()
      .from(attachments)
      .where(eq(attachments.id, meta.id))
      .get();
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedBatch).not.toBeNull();

    for (const p of [`/files/${meta.id}`, `/v1/attachments/${meta.id}`]) {
      const res = await app.request(p, { headers: auth });
      expect(res.status).toBe(404);
      expect(((await res.json()) as Body).error.code).toBe("not_found");
    }
    const types = db
      .select()
      .from(activity)
      .all()
      .map((a) => a.type);
    expect(types).toContain("attachment_deleted");
  });

  it("purge needs canPurge and an already deleted attachment", async () => {
    const { app, upload, issue, auth, authYou, storedFiles } = setup();
    const meta = (await (await upload(issue.identifier, PNG)).json()) as any;
    const purge = (headers: HeadersInit) =>
      app.request(`/v1/attachments/${meta.id}?purge=true`, {
        method: "DELETE",
        headers,
      });
    expect((await purge(auth)).status).toBe(403);
    expect((await purge(authYou)).status).toBe(409); // not deleted yet
    await app.request(`/v1/attachments/${meta.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect((await purge(authYou)).status).toBe(200);
    expect(await storedFiles()).toHaveLength(0);
  });

  it("lets agents purge when ALLOW_AGENT_PURGE is on", async () => {
    const { app, upload, issue, auth } = setup({ ALLOW_AGENT_PURGE: "true" });
    const meta = (await (await upload(issue.identifier, PNG)).json()) as any;
    await app.request(`/v1/attachments/${meta.id}`, {
      method: "DELETE",
      headers: auth,
    });
    const res = await app.request(`/v1/attachments/${meta.id}?purge=true`, {
      method: "DELETE",
      headers: auth,
    });
    expect(res.status).toBe(200);
  });
});

describe("rejections store nothing", () => {
  const expectRejected = async (res: Response, status = 400) => {
    expect(res.status).toBe(status);
    const body = (await res.json()) as Body;
    expect(body.error).toMatchObject({ message: expect.any(String) });
    return body;
  };

  it("rejects a disallowed type", async () => {
    const { upload, issue, storedFiles } = setup();
    const body = await expectRejected(
      await upload(issue.identifier, "<html></html>", {
        type: "text/html",
        name: "x.html",
      }),
    );
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details.reason).toBe("unsupported_type");
    expect(await storedFiles()).toHaveLength(0);
  });

  it("rejects declared/sniffed mismatch", async () => {
    const { upload, issue, storedFiles } = setup();
    const body = await expectRejected(
      await upload(issue.identifier, PDF, { type: "image/png" }),
    );
    expect(body.error.details.reason).toBe("type_mismatch");
    expect(await storedFiles()).toHaveLength(0);
  });

  it("rejects oversize while streaming", async () => {
    const { upload, issue, storedFiles } = setup({
      MAX_ATTACHMENT_BYTES: "1000",
    });
    const body = await expectRejected(
      await upload(issue.identifier, Buffer.concat([PNG, PNG])),
    );
    expect(body.error.details.reason).toBe("too_large");
    expect(await storedFiles()).toHaveLength(0);
  });

  it("rejects a comment from another issue", async () => {
    const { upload, issue, other, services, storedFiles } = setup();
    const comment = services.comments.create("you", other.identifier, {
      body: "hi",
    });
    const res = await upload(issue.identifier, PNG, { commentId: comment.id });
    expect((await expectRejected(res)).error.code).toBe("validation_error");
    expect(await storedFiles()).toHaveLength(0);
  });

  it("accepts a comment on the same issue", async () => {
    const { upload, issue, services } = setup();
    const comment = services.comments.create("you", issue.identifier, {
      body: "hi",
    });
    const res = await upload(issue.identifier, PNG, { commentId: comment.id });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).commentId).toBe(comment.id);
  });

  it("rejects non-multipart, missing file and unknown issue", async () => {
    const { app, auth, upload, issue, storedFiles } = setup();
    const json = await app.request(
      `/v1/issues/${issue.identifier}/attachments`,
      { method: "POST", body: "{}", headers: auth },
    );
    await expectRejected(json);
    const form = new FormData();
    form.append("comment_id", "x");
    const none = await app.request(
      `/v1/issues/${issue.identifier}/attachments`,
      { method: "POST", body: form, headers: auth },
    );
    await expectRejected(none);
    await expectRejected(await upload("MAT-999", PNG), 404);
    expect(await storedFiles()).toHaveLength(0);
    expect(existsSync(dataDir)).toBe(true);
  });
});

describe("auth", () => {
  it("download without a token is 401, never public", async () => {
    const { app, upload, issue } = setup();
    const meta = (await (await upload(issue.identifier, PNG)).json()) as any;
    for (const p of [`/files/${meta.id}`, `/v1/files/${meta.id}`]) {
      expect((await app.request(p)).status).toBe(401);
    }
    expect((await app.request(`/v1/attachments/${meta.id}`)).status).toBe(401);
    const noAuthUpload = await upload(issue.identifier, PNG, { headers: {} });
    expect(noAuthUpload.status).toBe(401);
  });
});
