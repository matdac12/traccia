# Tailnet-only, published by `tailscale serve` on 443, path-routed

Nothing is public. An existing tailnet node serves one private hostname (`https://<your-tailnet-host>`): `/` goes to the dashboard and `/mcp`, `/v1/*`, `/files/*` to the API. We added no tag or ACL change in v1, and Funnel stays off. Runtimes outside the tailnet (CI, cloud agents, phone, claude.ai connectors) are unsupported until the OAuth phase. That phase would expose only `/mcp` publicly. Port 443 was freed on that node for this, which replaced an earlier plan to use 8443.
