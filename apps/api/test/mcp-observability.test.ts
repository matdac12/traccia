import { afterEach, describe, expect, it } from "vitest";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

const SECRET = "SECRET-ARG-9f3a1c";

function setup() {
  const t = createTestApp();
  const { token } = createToken(t.db, { name: "obs-test", actor: "agent" });
  const post = (body: unknown, headers: HeadersInit = {}, auth = true) =>
    t.app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": "obs-agent/1.0",
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const requestLines = () =>
    t.logs.map((l) => JSON.parse(l)).filter((l) => l.msg === "request");
  return { ...t, token, post, requestLines };
}

const call = (id: number, name: string, args: unknown = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

let last: ReturnType<typeof setup>;
afterEach(() => {
  last.sqlite.close();
});

describe("MCP observability", () => {
  it("logs method, tool name and handler time, and sets Server-Timing", async () => {
    last = setup();
    const res = await last.post(call(1, "whoami"));
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toMatch(
      /^mcp;dur=\d+\.\d;desc="tools\/call whoami"$/,
    );
    const [line] = last.requestLines();
    expect(line.mcpCalls).toEqual([{ method: "tools/call", tool: "whoami" }]);
    expect(line.mcpCount).toBe(1);
    expect(typeof line.mcpMs).toBe("number");
    expect(line.ms).toBeGreaterThanOrEqual(0);
  });

  it("logs the method for non-tool requests", async () => {
    last = setup();
    const res = await last.post({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toContain('desc="tools/list"');
    expect(last.requestLines()[0].mcpCalls).toEqual([{ method: "tools/list" }]);
  });

  it("bounds the log line for a batch", async () => {
    last = setup();
    const batch = Array.from({ length: 30 }, (_, i) => call(i + 1, "whoami"));
    const res = await last.post(batch);
    expect(res.status).toBe(200);
    const [line] = last.requestLines();
    expect(line.mcpCount).toBe(30);
    expect(line.mcpCalls).toHaveLength(20);
    expect(res.headers.get("server-timing")).toContain('desc="batch of 30"');
  });

  it("logs error code, message, protocol version and user agent on a 400", async () => {
    last = setup();
    const res = await last.post(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { "mcp-protocol-version": "1999-01-01" },
    );
    expect(res.status).toBe(400);
    const [line] = last.requestLines();
    expect(line.status).toBe(400);
    expect(line.errorCode).toBe(-32000);
    expect(line.errorMessage).toContain("Unsupported protocol version");
    expect(line.protocolVersion).toBe("1999-01-01");
    expect(line.userAgent).toBe("obs-agent/1.0");
  });

  it("still reports a parse error for non-JSON bodies, without logging the body", async () => {
    last = setup();
    const res = await last.post(`not json ${SECRET}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
    const [line] = last.requestLines();
    expect(line.errorCode).toBe(-32700);
    expect(last.logs.join("\n")).not.toContain(SECRET);
  });

  it("logs the REST-shaped error code on a 401", async () => {
    last = setup();
    const res = await last.post(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      {},
      false,
    );
    expect(res.status).toBe(401);
    const [line] = last.requestLines();
    expect(line.errorCode).toBe("unauthorized");
    expect(line.userAgent).toBe("obs-agent/1.0");
  });

  it("never logs arguments, bodies or tokens", async () => {
    last = setup();
    await last.post(call(1, "whoami", { secret: SECRET }));
    await last.post(
      call(2, "save_issue", { title: SECRET, description: SECRET }),
    );
    await last.post(call(3, "no_such_tool", { x: SECRET }));
    await last.post(
      { ...call(4, "whoami", { x: SECRET }), jsonrpc: "1.0" },
      { "mcp-protocol-version": "1999-01-01" },
    );
    const all = last.logs.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(last.token);
    expect(last.requestLines()).toHaveLength(4);
  });
});
