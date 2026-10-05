import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import { ValidationError } from "../service/errors.js";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type SourceFetcherOptions = {
  /** Test-only escape hatch: exact IPs exempt from the blocklist. Production leaves this empty. */
  allowedAddresses?: string[];
  resolve?: Resolver;
  /** Extra TLS options for `https.request` (tests pass a `ca`). */
  tls?: Pick<https.RequestOptions, "ca">;
  timeoutMs?: number;
  maxRedirects?: number;
};

export type SourceResponse = {
  /** Body stream; the caller enforces the byte cap while consuming it. */
  stream: Readable;
  contentType: string;
  contentLength: number | undefined;
  /** The URL actually fetched, after redirects. */
  finalUrl: URL;
};

export type SourceFetcher = (
  url: string,
  opts: { maxBytes: number },
) => Promise<SourceResponse>;

const defaultResolve: Resolver = async (hostname) => {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family as 4 | 6 }));
};

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
];

/** Parses dotted-quad IPv4 into 4 bytes, or undefined. */
function parseIPv4(s: string): number[] | undefined {
  const parts = s.split(".");
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : undefined;
}

/** Parses any textual IPv6 form (including `::` and embedded IPv4) into 16 bytes. */
function parseIPv6(input: string): number[] | undefined {
  let s = input.replace(/%.*$/, "");
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return undefined;
    const hex = (a: number, b: number) => ((a << 8) | b).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hex(v4[0]!, v4[1]!)}:${hex(v4[2]!, v4[3]!)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const toGroups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return undefined;
    const n = Number.parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes.length === 16 ? bytes : undefined;
}

function isBlockedIPv4(b: number[]): boolean {
  const [a, c, d] = [b[0]!, b[1]!, b[2]!];
  return (
    a === 0 || // "this" network
    a === 10 ||
    (a === 100 && c >= 64 && c <= 127) || // CGNAT
    a === 127 ||
    (a === 169 && c === 254) || // link-local, cloud metadata
    (a === 172 && c >= 16 && c <= 31) ||
    (a === 192 && c === 88 && d === 99) || // 6to4 relay
    (a === 192 && c === 0 && d === 0) || // IETF protocol assignments
    (a === 192 && c === 0 && d === 2) || // TEST-NET-1
    (a === 192 && c === 168) ||
    (a === 198 && (c === 18 || c === 19)) || // benchmarking
    (a === 198 && c === 51 && d === 100) || // TEST-NET-2
    (a === 203 && c === 0 && d === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

function isBlockedIPv6(b: number[]): boolean {
  const zeros = (from: number, to: number) =>
    b.slice(from, to).every((x) => x === 0);
  // ::/96 covers unspecified, loopback and deprecated IPv4-compatible forms.
  if (zeros(0, 12)) return true;
  // ::ffff:a.b.c.d (IPv4-mapped) and ::ffff:0:a.b.c.d (IPv4-translated).
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedIPv4(b.slice(12));
  }
  if (
    zeros(0, 8) &&
    b[8] === 0xff &&
    b[9] === 0xff &&
    b[10] === 0 &&
    b[11] === 0
  ) {
    return isBlockedIPv4(b.slice(12));
  }
  // 64:ff9b::/96 NAT64 embeds an IPv4 address.
  if (
    b[0] === 0 &&
    b[1] === 0x64 &&
    b[2] === 0xff &&
    b[3] === 0x9b &&
    zeros(4, 12)
  ) {
    return isBlockedIPv4(b.slice(12));
  }
  if (
    b[0] === 0 &&
    b[1] === 0x64 &&
    b[2] === 0xff &&
    b[3] === 0x9b &&
    b[4] === 0 &&
    b[5] === 1
  ) {
    return true; // 64:ff9b:1::/48 local-use NAT64
  }
  // 2002::/16 6to4 embeds an IPv4 address.
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedIPv4(b.slice(2, 6));
  // 2001::/32 Teredo, 2001:db8::/32 documentation.
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8)
    return true;
  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1]! & 0xc0) >= 0x80) return true; // fe80::/10 link-local, fec0::/10 site-local
  if (b[0] === 0xff) return true; // multicast
  return false;
}

/** True if the textual IP address is in a range the server must never fetch. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIPv4(parseIPv4(address) ?? [0, 0, 0, 0]);
  if (family === 6)
    return isBlockedIPv6(parseIPv6(address) ?? Array(16).fill(0));
  return true; // not an IP at all: fail closed
}

const blocked = (what: string) =>
  new ValidationError(
    `sourceUrl rejected: ${what} resolves to a private, loopback, link-local or metadata address. Use a publicly reachable HTTPS URL or send contentBase64 instead.`,
  );

/** Resolves and vets `url`'s host, returning the single address to pin the connection to. */
async function vetTarget(
  url: URL,
  resolve: Resolver,
  isBlocked: (address: string) => boolean,
): Promise<ResolvedAddress> {
  if (url.protocol !== "https:") {
    throw new ValidationError(
      "sourceUrl must use https:// (http and other schemes are not allowed)",
    );
  }
  if (url.username || url.password) {
    throw new ValidationError("sourceUrl must not contain credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new ValidationError("sourceUrl has no host");

  const literal = isIP(host);
  if (literal) {
    if (isBlocked(host)) throw blocked(host);
    return { address: host, family: literal as 4 | 6 };
  }
  const lower = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.some((h) => lower === h || lower.endsWith(`.${h}`))) {
    throw blocked(host);
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new ValidationError(`sourceUrl host "${host}" could not be resolved`);
  }
  if (addresses.length === 0) {
    throw new ValidationError(`sourceUrl host "${host}" could not be resolved`);
  }
  // Every record must be public: a mixed answer is a rebinding signal.
  if (addresses.some((a) => isBlocked(a.address))) {
    throw blocked(host);
  }
  return addresses[0]!;
}

function request(
  url: URL,
  target: ResolvedAddress,
  opts: SourceFetcherOptions,
  timeoutMs: number,
): Promise<{ res: import("node:http").IncomingMessage; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const req = https.request(
      {
        method: "GET",
        host: target.address, // pinned: no second DNS lookup happens
        family: target.family,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        servername: isIP(host) ? undefined : host, // SNI and cert check against the name
        headers: {
          Host: url.host,
          Accept: "*/*",
          "Accept-Encoding": "identity",
        },
        ...opts.tls,
      },
      (res) => {
        response = res;
        resolve({ res, cleanup: () => clearTimeout(timer) });
      },
    );
    // One deadline for connect, headers and the whole body. Once the response
    // exists, destroying it surfaces a readable error to whoever consumes it.
    let response: import("node:http").IncomingMessage | undefined;
    const timer = setTimeout(() => {
      const err = new ValidationError("sourceUrl timed out");
      if (response) response.destroy(err);
      else req.destroy(err);
    }, timeoutMs);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

/**
 * Builds the `sourceUrl` fetcher: HTTPS only, DNS resolved and vetted by us,
 * the connection pinned to the vetted IP (defeats DNS rebinding), every
 * redirect vetted again, redirects capped, one overall timeout.
 */
export function createSourceFetcher(
  options: SourceFetcherOptions = {},
): SourceFetcher {
  const resolve = options.resolve ?? defaultResolve;
  const allowed = new Set(options.allowedAddresses ?? []);
  const isBlocked = (address: string) =>
    isBlockedAddress(address) && !allowed.has(address);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 3;

  return async (rawUrl, { maxBytes }) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ValidationError("sourceUrl is not a valid URL");
    }
    const deadline = Date.now() + timeoutMs;
    for (let hops = 0; ; hops++) {
      const target = await vetTarget(url, resolve, isBlocked);
      let got: Awaited<ReturnType<typeof request>>;
      try {
        got = await request(
          url,
          target,
          options,
          Math.max(1, deadline - Date.now()),
        );
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError(
          "sourceUrl could not be fetched (connection or TLS failure)",
        );
      }
      const { res, cleanup } = got;
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy();
        cleanup();
        if (hops >= maxRedirects) {
          throw new ValidationError(
            `sourceUrl redirected more than ${maxRedirects} times`,
          );
        }
        try {
          url = new URL(res.headers.location, url);
        } catch {
          throw new ValidationError("sourceUrl redirected to an invalid URL");
        }
        continue; // loop re-vets scheme and address of the new target
      }
      if (status < 200 || status >= 300) {
        res.destroy();
        cleanup();
        throw new ValidationError(`sourceUrl responded with HTTP ${status}`);
      }
      const length = Number(res.headers["content-length"]);
      if (Number.isFinite(length) && length > maxBytes) {
        res.destroy();
        cleanup();
        throw new ValidationError(
          `sourceUrl content is ${length} bytes, over the ${maxBytes} byte limit`,
        );
      }
      res.once("close", cleanup);
      return {
        stream: res,
        contentType: String(res.headers["content-type"] ?? ""),
        contentLength: Number.isFinite(length) ? length : undefined,
        finalUrl: url,
      };
    }
  };
}
