import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createBearerVerifier } from "../src/auth/verifier.js";
import { runCli } from "../src/cli/index.js";
import { openDatabase } from "../src/db/connection.js";
import { hashToken } from "../src/service/tokens.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length)
    rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function env() {
  const dir = mkdtempSync(join(tmpdir(), "tracker-cli-"));
  dirs.push(dir);
  return { DATA_DIR: dir, BASE_URL: "http://localhost:8787" };
}

function migrationCount(dataDir: string) {
  const sqlite = new Database(join(dataDir, "tracker.db"));
  const row = sqlite
    .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
    .get() as { n: number };
  sqlite.close();
  return row.n;
}

describe("tracker db migrate", () => {
  it("is idempotent: running twice leaves the same applied migrations", async () => {
    const e = env();
    expect(await runCli(["db", "migrate"], e)).toBe(0);
    const first = migrationCount(e.DATA_DIR);
    expect(await runCli(["db", "migrate"], e)).toBe(0);
    expect(migrationCount(e.DATA_DIR)).toBe(first);
  });

  it("fails with a message naming the bad variable", async () => {
    const e = { ...env(), BASE_URL: "" };
    const errors: string[] = [];
    const code = await runCli(["db", "migrate"], e, (m) => errors.push(m));
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/BASE_URL/);
  });

  it("rejects unknown commands", async () => {
    expect(await runCli(["nope"], env(), () => {})).toBe(1);
  });
});

describe("tracker token", () => {
  async function run(e: ReturnType<typeof env>, ...argv: string[]) {
    const out: string[] = [];
    const errors: string[] = [];
    const code = await runCli(
      argv,
      e,
      (m) => errors.push(m),
      (m) => out.push(m),
    );
    return { code, out: out.join("\n"), err: errors.join("\n") };
  }

  async function migrated() {
    const e = env();
    await runCli(
      ["db", "migrate"],
      e,
      () => {},
      () => {},
    );
    return e;
  }

  const bearer = (token: string) =>
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } });

  async function verify(e: ReturnType<typeof env>, token: string) {
    const { sqlite, db } = openDatabase(e.DATA_DIR);
    try {
      return await createBearerVerifier(db)(bearer(token));
    } finally {
      sqlite.close();
    }
  }

  const tokenOf = (out: string) => /trk_\S+/.exec(out)?.[0] as string;
  const idOf = (out: string) => /Created token (\S+)/.exec(out)?.[1] as string;

  it("create prints a token that verifies; revoke makes it fail immediately", async () => {
    const e = await migrated();
    const created = await run(
      e,
      "token",
      "create",
      "--name",
      "ci",
      "--actor",
      "agent",
    );
    expect(created.code).toBe(0);
    const token = tokenOf(created.out);
    expect(await verify(e, token)).toMatchObject({
      actor: "agent",
      tokenName: "ci",
    });

    const revoked = await run(e, "token", "revoke", idOf(created.out));
    expect(revoked.code).toBe(0);
    expect(await verify(e, token)).toBeNull();
  });

  it("list shows metadata but never the plaintext or hash", async () => {
    const e = await migrated();
    const created = await run(
      e,
      "token",
      "create",
      "--name",
      "dash",
      "--actor",
      "you",
    );
    const token = tokenOf(created.out);
    const listed = await run(e, "token", "list");
    expect(listed.out).toContain(idOf(created.out));
    expect(listed.out).toContain("dash");
    expect(listed.out).not.toContain(token);
    expect(listed.out).not.toContain(hashToken(token));
    expect(listed.out).not.toContain("trk_");
  });

  it("revoke is idempotent and reports an already revoked token", async () => {
    const e = await migrated();
    const id = idOf(
      (await run(e, "token", "create", "--name", "a", "--actor", "you")).out,
    );
    expect((await run(e, "token", "revoke", id)).out).toMatch(/Revoked/);
    const again = await run(e, "token", "revoke", id);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already revoked/);
  });

  it("revoke of an unknown id fails", async () => {
    const r = await run(await migrated(), "token", "revoke", "nope");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not found/);
  });

  it("--actor rejects anything but agent or you", async () => {
    const e = await migrated();
    for (const actor of ["admin", ""]) {
      const r = await run(
        e,
        "token",
        "create",
        "--name",
        "x",
        "--actor",
        actor,
      );
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/agent, you/);
    }
    expect((await run(e, "token", "create", "--name", "x")).code).toBe(1);
    expect((await run(e, "token", "list")).out).toBe("No tokens.");
  });

  it("create requires --name", async () => {
    const r = await run(await migrated(), "token", "create", "--actor", "you");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--name/);
  });

  it("every command answers --help with exit 0", async () => {
    const e = {} as ReturnType<typeof env>; // help needs no config or database
    for (const argv of [
      ["--help"],
      ["token", "--help"],
      ["token", "create", "--help"],
      ["token", "list", "--help"],
      ["token", "revoke", "--help"],
      ["db", "migrate", "--help"],
    ]) {
      const r = await run(e, ...argv);
      expect(r.code, argv.join(" ")).toBe(0);
      expect(r.out).toMatch(/Usage/);
    }
  });

  it("plaintext appears only in the create output", async () => {
    const e = await migrated();
    const created = await run(
      e,
      "token",
      "create",
      "--name",
      "once",
      "--actor",
      "agent",
    );
    const id = idOf(created.out);
    const token = tokenOf(created.out);
    const others = [
      await run(e, "token", "list"),
      await run(e, "token", "revoke", id),
      await run(e, "token", "revoke", id),
    ];
    for (const r of others) expect(r.out + r.err).not.toContain(token);
  });
});
