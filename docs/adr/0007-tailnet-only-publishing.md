# Tailnet-only, published by `tailscale serve` on 443, path-routed

Nothing is public. The existing node `omni` serves one hostname (`https://omni.tail2b3fbf.ts.net`): `/` goes to the dashboard and `/mcp`, `/v1/*`, `/files/*` to the API. We added no tag or ACL change in v1, and Funnel stays off. Runtimes outside the tailnet (CI, cloud agents, phone, claude.ai connectors) are unsupported until the OAuth phase. That phase would expose only `/mcp` publicly. Port 443 was freed on `omni` for this, which replaced an earlier plan to use 8443.
