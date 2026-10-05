import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

describe("tracker db snapshot", () => {
  async function run(e: ReturnType<typeof env>, ...argv: string[]) {
    const out: string[] = [];
    const errors: string[] = [];
    const code = await runCli(
      ["db", "snapshot", ...argv],
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

  const snapshots = (dir: string) =>
    readdirSync(dir)
      .filter((f) => /^tracker-.*\.db$/.test(f))
      .sort();

  it("writes tracker-<UTC timestamp>.db to DATA_DIR/backups by default", async () => {
    const e = await migrated();
    const r = await run(e);
    expect(r.code).toBe(0);
    const files = snapshots(join(e.DATA_DIR, "backups"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^tracker-\d{8}T\d{6}Z\.db$/);
  });

  it("opens cleanly with integrity_check ok and the migrated schema", async () => {
    const e = await migrated();
    await run(e);
    const dir = join(e.DATA_DIR, "backups");
    const copy = new Database(join(dir, snapshots(dir)[0] as string), {
      readonly: true,
    });
    expect(copy.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(
      (
        copy
          .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
          .get() as {
          n: number;
        }
      ).n,
    ).toBe(migrationCount(e.DATA_DIR));
    copy.close();
  });

  it("is consistent while another process writes in a loop", async () => {
    const e = await migrated();
    // A separate process commits two-row transactions as fast as it can, so
    // writes genuinely overlap each snapshot.
    const writerScript = `
      const D = require("better-sqlite3");
      const db = new D(process.argv[1]);
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      db.exec("CREATE TABLE pairs (id INTEGER PRIMARY KEY, grp INTEGER)");
      const ins = db.prepare("INSERT INTO pairs (grp) VALUES (?)");
      const pair = db.transaction((g) => { ins.run(g); ins.run(g); });
      console.log("ready");
      for (let g = 0; ; g++) pair(g);
    `;
    const writer = spawn(
      process.execPath,
      ["-e", writerScript, join(e.DATA_DIR, "tracker.db")],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        writer.once("error", reject);
        writer.once("exit", (c) => reject(new Error(`writer exited ${c}`)));
        writer.stdout.once("data", () => resolve());
      });
      const dir = join(e.DATA_DIR, "backups");
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 50));
        expect((await run(e, "--keep", "10")).code).toBe(0);
        await new Promise((r) => setTimeout(r, 1100));
      }
      for (const f of snapshots(dir)) {
        const copy = new Database(join(dir, f), { readonly: true });
        expect(copy.pragma("integrity_check")).toEqual([
          { integrity_check: "ok" },
        ]);
        const rows = copy
          .prepare("SELECT grp, count(*) AS n FROM pairs GROUP BY grp")
          .all() as { n: number }[];
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.n === 2)).toBe(true);
        copy.close();
      }
      expect(snapshots(dir)).toHaveLength(3);
    } finally {
      writer.removeAllListeners("exit");
      writer.kill();
    }
  }, 20_000);

  it("keeps exactly the newest N and ignores unrelated files", async () => {
    const e = await migrated();
    const dir = join(e.DATA_DIR, "backups");
    mkdirSync(dir, { recursive: true });
    for (const d of ["20200101", "20200102", "20200103", "20200104"]) {
      writeFileSync(join(dir, `tracker-${d}T000000Z.db`), "old");
    }
    writeFileSync(join(dir, "notes.txt"), "keep me");
    const r = await run(e, "--keep", "3");
    expect(r.code).toBe(0);
    const files = snapshots(dir);
    expect(files).toHaveLength(3);
    expect(files.slice(0, 2)).toEqual([
      "tracker-20200103T000000Z.db",
      "tracker-20200104T000000Z.db",
    ]);
    expect(readdirSync(dir)).toContain("notes.txt");
  });

  it("fails clearly on a non-writable --out and removes nothing", async () => {
    const e = await migrated();
    const out = join(e.DATA_DIR, "ro");
    mkdirSync(out);
    writeFileSync(join(out, "tracker-20200101T000000Z.db"), "old");
    chmodSync(out, 0o500);
    try {
      if (process.getuid?.() === 0) return; // root ignores permissions
      const r = await run(e, "--out", out);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/Cannot write snapshots to .*--out/);
      expect(snapshots(out)).toEqual(["tracker-20200101T000000Z.db"]);
    } finally {
      chmodSync(out, 0o700);
    }
  });

  it("fails when --out is a file", async () => {
    const e = await migrated();
    const file = join(e.DATA_DIR, "afile");
    writeFileSync(file, "x");
    const r = await run(e, "--out", file);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Cannot write snapshots/);
  });

  it("rejects a bad --keep and a missing database", async () => {
    const e = await migrated();
    expect((await run(e, "--keep", "0")).code).toBe(1);
    expect((await run(e, "--keep", "abc")).err).toMatch(/--keep/);
    const empty = env();
    const r = await run(empty);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/No database/);
    expect(existsSync(join(empty.DATA_DIR, "tracker.db"))).toBe(false);
  });

  it("help needs no database", async () => {
    const r = await run({ DATA_DIR: "", BASE_URL: "" }, "--help");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/snapshot/);
  });
});

describe("tracker db reindex", () => {
  it("rebuilds the search index and is idempotent", async () => {
    const e = env();
    const out: string[] = [];
    const run = (...argv: string[]) =>
      runCli(
        argv,
        e,
        () => {},
        (m) => out.push(m),
      );
    await run("db", "migrate");
    const { sqlite, db } = openDatabase(e.DATA_DIR);
    const { createServices } = await import("../src/service/index.js");
    const s = createServices({ db, defaultIssueKey: "MAT" });
    const p = s.projects.create("you", { name: "P" });
    s.issues.create("you", { project: p.id, title: "findable" });
    sqlite.exec("DELETE FROM search_index");
    sqlite.close();
    expect(await run("db", "reindex")).toBe(0);
    expect(await run("db", "reindex")).toBe(0);
    expect(out.at(-1)).toBe("search index rebuilt: 1 issues, 0 comments");
    const again = openDatabase(e.DATA_DIR);
    const s2 = createServices({ db: again.db, defaultIssueKey: "MAT" });
    expect(s2.search.search({ q: "findable" }).items).toHaveLength(1);
    again.sqlite.close();
  });
});
