import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { API_PORT, E2E_LOGIN, LOGIN_HEADER, WEB_PORT } from "./ports";

const webDir = resolve(__dirname, "../..");
const apiDir = resolve(webDir, "../api");
const bin = (dir: string, name: string) => join(dir, "node_modules/.bin", name);

export type Stack = { apiUrl: string; webUrl: string; token: string; stop: () => Promise<void> };

async function waitFor(url: string, what: string, timeoutMs: number, init?: RequestInit) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${what} did not become ready at ${url} within ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Fails fast when something else holds the port: `waitFor` could otherwise be satisfied by the wrong server. */
function assertPortFree(port: number) {
  return new Promise<void>((ok, fail) => {
    const probe = createServer();
    probe.once("error", () => fail(new Error(`port ${port} is in use; stop that process or set E2E_WEB_PORT / E2E_API_PORT`)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => ok()));
  });
}

/** Own process group, so stopping it also stops the grandchildren (`tsx` and `next dev` both fork). */
function start(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
  return spawn(command, args, { ...options, stdio: "inherit", detached: true });
}

/**
 * Starts a real API on a throwaway SQLite database (created fresh in the OS temp dir) and the dashboard
 * in dev mode against it. Only the processes started here are ever signalled.
 */
export async function startStack(): Promise<Stack> {
  const dataDir = mkdtempSync(join(tmpdir(), "traccia-e2e-"));
  const apiUrl = `http://127.0.0.1:${API_PORT}`;
  const webUrl = `http://127.0.0.1:${WEB_PORT}`;
  const apiEnv = { ...process.env, DATA_DIR: dataDir, BASE_URL: apiUrl, PORT: String(API_PORT), LOG_LEVEL: "silent", RATE_LIMIT_PER_MIN: "100000" };
  const children: ChildProcess[] = [];

  const cli = (...args: string[]) => {
    const r = spawnSync(bin(apiDir, "tsx"), ["src/cli/index.ts", ...args], { cwd: apiDir, env: apiEnv, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`traccia ${args.slice(0, 2).join(" ")} failed:\n${r.stderr}`);
    return r.stdout;
  };

  const stop = async () => {
    await Promise.all(
      children.map(
        (c) =>
          new Promise<void>((done) => {
            if (c.exitCode !== null || c.signalCode !== null) return done();
            const group = (signal: NodeJS.Signals) => {
              try {
                process.kill(-(c.pid as number), signal);
              } catch {
                // already gone
              }
            };
            const force = setTimeout(() => group("SIGKILL"), 5000);
            c.once("exit", () => {
              clearTimeout(force);
              group("SIGKILL"); // grandchildren that outlived the wrapper
              done();
            });
            group("SIGTERM");
          }),
      ),
    );
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    await Promise.all([assertPortFree(API_PORT), assertPortFree(WEB_PORT)]);
    cli("db", "migrate");
    // The plaintext token is shown once on stdout; it is parsed here and never printed or written to disk.
    const token = /trk_[A-Za-z0-9_-]+/.exec(cli("token", "create", "--name", "e2e", "--actor", "you"))?.[0];
    if (!token) throw new Error("could not read the token from `traccia token create`");

    children.push(start(bin(apiDir, "tsx"), ["src/main.ts"], { cwd: apiDir, env: apiEnv }));
    await waitFor(`${apiUrl}/healthz`, "api", 30_000);

    const webEnv: NodeJS.ProcessEnv = {
      ...process.env,
      // Never inherit a shell's NODE_ENV=production: the dev-only server must run as development.
      NODE_ENV: "development",
      TRACCIA_API_URL: apiUrl,
      TRACCIA_API_TOKEN: token,
      DASHBOARD_ALLOWED_LOGINS: E2E_LOGIN,
      DASHBOARD_DEV_LOGIN: "",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    children.push(start(bin(webDir, "next"), ["dev", "--webpack", "-p", String(WEB_PORT), "-H", "127.0.0.1"], { cwd: webDir, env: webEnv }));
    await waitFor(`${webUrl}/healthz`, "dashboard", 120_000, { headers: { [LOGIN_HEADER]: E2E_LOGIN } });
    return { apiUrl, webUrl, token, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
