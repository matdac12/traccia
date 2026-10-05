import { readFileSync } from "node:fs";
import type { RequestListener } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSourceFetcher,
  isBlockedAddress,
  type Resolver,
} from "../src/mcp/ssrf-fetch.js";

const fixture = (n: string) =>
  readFileSync(path.join(import.meta.dirname, "fixtures", n));
const cert = fixture("test-cert.pem");
const key = fixture("test-key.pem");

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:a00:1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:db8::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.255.255",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "2002:808:808::1",
  ])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

const servers: https.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function serve(handler: RequestListener) {
  const server = https.createServer({ cert, key }, handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

const fetcher = (
  extra: Parameters<typeof createSourceFetcher>[0] = {},
  maxBytes = 1024,
) => {
  const f = createSourceFetcher({ tls: { ca: cert }, ...extra });
  return (url: string) => f(url, { maxBytes });
};

const body = async (s: AsyncIterable<Buffer>) => {
  const parts: Buffer[] = [];
  for await (const c of s) parts.push(c);
  return Buffer.concat(parts).toString();
};

describe("source fetcher: hostile input", () => {
  const fetchIt = fetcher();

  it.each([
    "https://127.0.0.1/x.png",
    "https://127.0.0.1:8443/x.png",
    "https://localhost/x.png",
    "https://LOCALHOST./x.png",
    "https://foo.localhost/x.png",
    "https://169.254.169.254/latest/meta-data/",
    "https://metadata.google.internal/",
    "https://[::1]/x.png",
    "https://[::ffff:127.0.0.1]/x.png",
    "https://[::ffff:7f00:1]/x.png",
    "https://[fd00::1]/x.png",
    "https://10.0.0.1/",
    "https://192.168.0.1/",
    "https://0.0.0.0/",
    "https://2130706433/", // decimal form of 127.0.0.1
    "https://0x7f.1/", // hex/short form of 127.0.0.1
    "https://017700000001/", // octal form
  ])("rejects %s as a blocked address", async (url) => {
    await expect(fetchIt(url)).rejects.toThrow(
      /private, loopback, link-local or metadata/,
    );
  });

  it("rejects a hostname resolving to a private IP", async () => {
    const resolve: Resolver = async () => [{ address: "10.0.0.5", family: 4 }];
    await expect(
      fetcher({ resolve })("https://internal.example.test/x.png"),
    ).rejects.toThrow(/private, loopback/);
  });

  it("rejects a mixed public/private DNS answer", async () => {
    const resolve: Resolver = async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(
      fetcher({ resolve })("https://rebind.example.test/x.png"),
    ).rejects.toThrow(/private, loopback/);
  });

  it("rejects an unresolvable host", async () => {
    const resolve: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(fetcher({ resolve })("https://nope.test/")).rejects.toThrow(
      /could not be resolved/,
    );
  });

  it.each([
    "http://example.com/x.png",
    "http://127.0.0.1/x.png",
    "ftp://example.com/x.png",
    "file:///etc/passwd",
    "gopher://example.com/",
  ])("rejects non-https %s", async (url) => {
    await expect(fetchIt(url)).rejects.toThrow(/https/);
  });

  it("rejects credentials in the URL and malformed URLs", async () => {
    await expect(fetchIt("https://user:pw@8.8.8.8/")).rejects.toThrow(
      /credentials/,
    );
    await expect(fetchIt("not a url")).rejects.toThrow(/not a valid URL/);
  });
});

describe("source fetcher: against a local HTTPS server", () => {
  const allowed = { allowedAddresses: ["127.0.0.1"] };
  const resolveToLoopback: Resolver = async () => [
    { address: "127.0.0.1", family: 4 },
  ];

  it("is blocked by default, and works once the address is explicitly allowed", async () => {
    const port = await serve((_req, res) => {
      res.setHeader("Content-Type", "text/plain");
      res.end("hello");
    });
    const url = `https://127.0.0.1:${port}/a.txt`;
    await expect(fetcher()(url)).rejects.toThrow(/private, loopback/);
    const got = await fetcher(allowed)(url);
    expect(got.contentType).toBe("text/plain");
    expect(await body(got.stream)).toBe("hello");
  });

  it("pins the connection to the vetted IP and keeps the hostname for TLS and Host", async () => {
    let host: string | undefined;
    const port = await serve((req, res) => {
      host = req.headers.host;
      res.end("ok");
    });
    let lookups = 0;
    const resolve: Resolver = async (h) => {
      lookups++;
      expect(h).toBe("files.example.test");
      return [{ address: "127.0.0.1", family: 4 }];
    };
    const got = await fetcher({ ...allowed, resolve })(
      `https://files.example.test:${port}/x`,
    );
    expect(await body(got.stream)).toBe("ok");
    expect(lookups).toBe(1);
    expect(host).toBe(`files.example.test:${port}`);
  });

  it("follows a redirect to an allowed target", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { Location: "/final" }).end();
      } else res.end("done");
    });
    const got = await fetcher({ ...allowed, resolve: resolveToLoopback })(
      `https://files.example.test:${port}/start`,
    );
    expect(await body(got.stream)).toBe("done");
    expect(got.finalUrl.pathname).toBe("/final");
  });

  it.each([
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]:1/",
    "https://10.0.0.1/",
    "https://localhost/",
    "http://files.example.test/plain",
  ])("rejects a redirect to %s", async (target) => {
    const port = await serve((_req, res) => {
      res.writeHead(302, { Location: target }).end();
    });
    await expect(
      fetcher({ ...allowed, resolve: resolveToLoopback })(
        `https://files.example.test:${port}/`,
      ),
    ).rejects.toThrow(/private, loopback|https/);
  });

  it("rejects a redirect to a hostname that resolves to a private IP", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(302, { Location: "https://evil.example.test/" }).end();
    });
    const resolve: Resolver = async (h) => [
      {
        address: h === "evil.example.test" ? "192.168.1.1" : "127.0.0.1",
        family: 4,
      },
    ];
    await expect(
      fetcher({ ...allowed, resolve })(`https://files.example.test:${port}/`),
    ).rejects.toThrow(/private, loopback/);
  });

  it("caps redirects", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(302, { Location: "/again" }).end();
    });
    await expect(
      fetcher({ ...allowed, resolve: resolveToLoopback, maxRedirects: 2 })(
        `https://files.example.test:${port}/`,
      ),
    ).rejects.toThrow(/redirected more than 2 times/);
  });

  it("rejects non-2xx responses", async () => {
    const port = await serve((_req, res) => res.writeHead(404).end());
    await expect(
      fetcher(allowed)(`https://127.0.0.1:${port}/`),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("rejects an oversize Content-Length before reading the body", async () => {
    const port = await serve((_req, res) => res.end("x".repeat(2048)));
    await expect(
      fetcher(allowed, 1024)(`https://127.0.0.1:${port}/`),
    ).rejects.toThrow(/over the 1024 byte limit/);
  });

  it("times out a server that never answers", async () => {
    const port = await serve(() => {});
    await expect(
      fetcher({ ...allowed, timeoutMs: 150 })(`https://127.0.0.1:${port}/`),
    ).rejects.toThrow(/timed out/);
  });

  it("times out a body that stalls", async () => {
    const port = await serve((_req, res) => {
      res.write("partial");
    });
    const got = await fetcher({ ...allowed, timeoutMs: 200 })(
      `https://127.0.0.1:${port}/`,
    );
    await expect(body(got.stream)).rejects.toThrow();
  });

  it("fails on an untrusted certificate", async () => {
    const port = await serve((_req, res) => res.end("x"));
    const f = createSourceFetcher(allowed); // no ca: self-signed is untrusted
    await expect(
      f(`https://127.0.0.1:${port}/`, { maxBytes: 10 }),
    ).rejects.toThrow(/connection or TLS failure/);
  });
});
