# claude.ai custom connector via Tailscale Funnel (port 8443)

Retrieved 2026-10-06. Sources fetched and read directly; GitHub issue bodies were read through a page-summarising fetch tool, so quotes from issues are as returned by that tool, not guaranteed verbatim.

## Verdict

"Only port 443 works" is **not confirmed by Anthropic**. No official doc states it, and no Anthropic maintainer was seen saying it. Two third-party sources say moving from 8443 to 443 fixed it. Neither is a controlled test. Anthropic's own docs list other causes of "Couldn't reach" with zero inbound traffic. Those mostly do not fit your setup.

## Confirmed (with source)

1. **Anthropic docs: "Couldn't reach" can mean Anthropic rejected the connection before any request left its network.** ([troubleshooting](https://claude.com/docs/connectors/building/troubleshooting))
   - "If any resolved address isn't globally routable, Claude rejects the connection before any HTTP request leaves Anthropic's network. Your server's access logs see nothing, and Claude reports 'Couldn't reach.'"
   - Rejected: `10/8`, `172.16/12`, `192.168/16`, CGNAT `100.64.0.0/10`, loopback, link-local, or a mix of public and non-public addresses.
   - "Has no `A` record from public DNS. Connectors are IPv4-only..."
   - Your name resolves to a public Funnel IPv4 (185.40.234.x), so these checks should pass. Confirm with `dig +short` from outside the tailnet that every address returned is public. I did not re-run it.
2. **The Anthropic docs say nothing about ports.** I read the troubleshooting and testing pages in full. `https://claude.com/llms.txt` returned only a marketing index (the docs index is `https://claude.com/docs/llms.txt`, not read). I did not read the authentication page or search the MCP spec. No port restriction found.
3. **The `ofid_` id is documented as traceable by Anthropic.** (same troubleshooting page)
   - "The ID lets Anthropic trace the exact failure on its side, and it's time-limited, so report soon after the failure."
   - Support channel: the [anthropics/claude-ai-mcp issue tracker](https://github.com/anthropics/claude-ai-mcp/issues). Include the ofid, server URL and server logs.
4. **Anthropic egress range:** outbound IPv4 `160.79.104.0/21`. ([IP address reference](https://platform.claude.com/docs/en/api/ip-addresses))
   - The page does not mention blocking `*.ts.net` or Tailscale ranges.
   - The troubleshooting page describes WAF/CDN blocks as 403/429 visible in your edge logs. You see zero requests, so that is a different failure.
5. **Funnel ports and bandwidth.** ([Funnel docs](https://tailscale.com/kb/1223/funnel))
   - "Funnel can only listen on ports `443`, `8443`, and `10000`."
   - "Traffic sent over a Funnel is subject to non-configurable bandwidth limits."
   - The same port cannot be used for Serve and Funnel at the same time.
   - The page gives no timeout or SSE figures.
6. **Funnel exposure is per port, not per path.** ([Tailscale source `ipn/serve.go`](https://raw.githubusercontent.com/tailscale/tailscale/main/ipn/serve.go))
   - `AllowFunnel` is "the set of SNI:port values for which funnel traffic is allowed".
   - `Web` handlers are keyed by mount point within a host:port.
   - Local CLI (`tailscale` 1.102.4, `funnel --help`): `--https <port>` and `--set-path`, which only sets the path a handler is mounted on.
   - Inference, not stated in the docs: once a host:port is funnelled, every handler on it is public. You cannot keep a private dashboard at `/` on a port where `/mcp` is public.
7. **A working connector on 443.** The gist ([mrmartineau, last active 2026-09-18](https://gist.github.com/mrmartineau/475dc3e8ffc6908f1493a05989a116ff)) uses `sudo tailscale funnel --bg --https=443 127.0.0.1:8100`.
   - The connector URL is `https://<host>.<tailnet>.ts.net/mcp`, with GitHub OAuth.
   - It is a first-hand how-to by a private author. It supports "works on 443 at `/mcp`" but is not proof of any cause.

## Reported but unverified (third-party, no Anthropic confirmation)

- **Blog, [ivanmorgillo.com, 2026-06-13](https://www.ivanmorgillo.com/2026/06/13/claude-app-self-hosted-second-brain/)** (own OAuth 2.1 server, Funnel).
  - "I'd published on port `8443` (Funnel allows 443, 8443, 10000). But **Anthropic's connector backend only dials the standard port 443.**"
  - He moved to 443 and it connected. Closest match to your case. It is trial and error, not an Anthropic statement.
- **ha-mcp FAQ and webhook-proxy docs** ([FAQ](https://github.com/homeassistant-ai/ha-mcp/blob/master/docs/FAQ.md), [DOCS](https://github.com/homeassistant-ai/ha-mcp/blob/master/homeassistant-addon-webhook-proxy/DOCS.md); project maintainers, not Anthropic).
  - "Funnel can also serve on the alternate HTTPS ports it offers (`8443`, `10000`), but Claude.ai's connector backend does not reliably reach non-standard ports."
  - "Use standard port `443` instead, where the same setup connects on the first try."
  - The FAQ cites ha-mcp issue #2080 for this, but that issue (fetched) is about an OAuth audience mismatch, not ports. I could not find the supporting evidence.
- **[claude-ai-mcp #209](https://github.com/anthropics/claude-ai-mcp/issues/209)** (Apr 2026, @jeffstrahl).
  - `https://mcp.gvec.org:8443/sse`, nginx, valid cert, public DNS. Zero traffic reached the server, "Couldn't reach ... ofid_40e4a06e4623ecd3".
  - Closed "not planned", no resolution seen. Same symptom on 8443, cause unknown.
- **Failing Funnel reports on `*.ts.net`, none resolved.** No Anthropic comments were visible in any of them.
  - [#953](https://github.com/anthropics/claude-ai-mcp/issues/953) (open): `https://truenas-mcp.tailee23bf.ts.net/mcp`, port 443, no auth. The reporter had a Funnel registration outage with public NXDOMAIN, then kept failing after it recovered. They suspect Anthropic-side DNS caching. This matches your timeline (A record only visible shortly before the first attempt). It is speculation.
  - [#1026](https://github.com/anthropics/claude-ai-mcp/issues/1026) (closed): `https://diskstation.tail774972.ts.net/api/mcp`, no explicit port. Both Funnel and a Cloudflare Quick Tunnel failed with zero inbound requests. So a non-8443 URL is not a guaranteed fix.
  - [#479](https://github.com/anthropics/claude-ai-mcp/issues/479) (closed, not planned): the reporter claims an "account/URL-keyed cached negative verdict" that survives remove and re-add. Speculation, but the same pattern as #953.
  - Other zero-inbound reports not tied to ports: [#227](https://github.com/anthropics/claude-ai-mcp/issues/227), [#374](https://github.com/anthropics/claude-ai-mcp/issues/374), [#1023](https://github.com/anthropics/claude-ai-mcp/issues/1023).

## Not found

- No Anthropic statement (docs or maintainer) about which ports the connector backend can dial.
- No report of a working claude.ai connector on 8443 or 10000 (searches were not exhaustive).
- No documentation that `*.ts.net` or Tailscale ranges are blocked.
- No documented DNS negative-cache TTL on Anthropic's side.
- No Tailscale doc on Funnel timeouts or long-lived SSE streams.
- No Tailscale doc recommending a sidecar or Tailscale Services for exposing one MCP endpoint (the use-cases page does not cover it; I did not read the Services docs).
- MCP spec and Anthropic authentication page not checked for ports.

## Recommendation (limited to what is confirmed)

1. **Try port 443 first.** The only reports touching your symptom (8443, zero requests, ts.net) point to 443: the blog and the ha-mcp docs, plus a working 443 `/mcp` example in the gist. Nothing confirms it.
   - (b) 443 on the same host: Funnel is per port, so the private dashboard must leave 443 (and cannot take 8443 or 10000 while those are Funnel ports in use). Serve and Funnel cannot share a port.
   - (c) A dedicated Tailscale node with its own hostname on 443 gives the same 443 result without moving the dashboard and isolates the public surface. No source I read names it as an established pattern.
2. **(d) A custom-domain reverse proxy** is the fallback if 443 on `ts.net` also fails. #953 and #1026 show failures with no resolution, so 443 is not guaranteed. No source I found shows a Vercel-fronted Funnel working. Anthropic's docs warn against redirects to another host and against proxies that alter the `WWW-Authenticate` or `/.well-known/` responses.
3. **Keep 8443 (a) only as a control.** Nothing confirms it works.
4. If 443 also fails, file on the [claude-ai-mcp tracker](https://github.com/anthropics/claude-ai-mcp/issues) quickly (the ofid is time-limited) with the ofid, URL and external `dig` output.

Unverified: that 443 fixes it for you, the cached-negative-DNS theory, whether Anthropic blocks `ts.net` or Funnel ingress ranges, and Funnel streaming limits.
