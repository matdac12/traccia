# Connecting agents to Traccia

How to connect Claude Code, Codex and OpenCode to the Traccia MCP server from a Mac or a Windows machine. Both must be on the tailnet. Once connected, agents follow the workflow in [agent-snippet.md](agent-snippet.md) and use the tools listed in [mcp-tools.md](mcp-tools.md).

- Endpoint: `https://omni.tail2b3fbf.ts.net/mcp`
- Auth: `Authorization: Bearer <token>`, with the token read from an environment variable, never written into a config file.

## 1. Get a token

Create one token per machine and agent, so writes are attributed correctly and one machine can be revoked alone. On the server (the host that runs the `api` container, see [backup-restore.md](backup-restore.md) for how it is deployed):

```bash
cd /opt/tracker && docker compose exec -T api node dist/tracker.js token create --name mac-claude --actor agent
```

The plaintext is printed once and cannot be shown again. Use `--actor agent` for agents. Only the dashboard's own token is `you`. Run `token list` (no secrets shown) and `token revoke <id>` the same way, replacing `token create ...`; revoking cuts a token off immediately.

Name each token `<tool>-<machine>`, one per tool and machine, for example `claude-code-mac`, `codex-windows` or `opencode-mac`. The name shows up as `tokenName` in `whoami` and in write attribution, and lets you revoke one tool on one machine alone.

Name the variable `TRACCIA_TOKEN`. Claude Code reads some credential names (such as `ANTHROPIC_AUTH_TOKEN` or `NPM_TOKEN`) as empty inside MCP headers, so avoid those names.

## 2. Set the environment variable

### macOS

Add to `~/.zshrc` (or the profile your agent's shell loads), then open a new terminal:

```bash
export TRACCIA_TOKEN='<paste the token>'
```

### Windows (PowerShell)

Persist it for your user, then open a new terminal:

```powershell
[Environment]::SetEnvironmentVariable('TRACCIA_TOKEN', '<paste the token>', 'User')
```

## 3. Claude Code

Use single quotes so your shell keeps `${TRACCIA_TOKEN}` as text. Claude Code expands it from the environment each time it starts, so the token is never stored in the config.

### macOS

```bash
claude mcp add --transport http --scope user tracker https://omni.tail2b3fbf.ts.net/mcp \
  --header 'Authorization: Bearer ${TRACCIA_TOKEN}'
```

### Windows (PowerShell)

```powershell
claude mcp add --transport http --scope user tracker https://omni.tail2b3fbf.ts.net/mcp --header 'Authorization: Bearer ${TRACCIA_TOKEN}'
```

`--scope user` makes the server available in every project. Use `--scope project` to write a `.mcp.json` into one repo instead; that file can be committed because it holds only the `${TRACCIA_TOKEN}` placeholder:

```json
{
  "mcpServers": {
    "tracker": {
      "type": "http",
      "url": "https://omni.tail2b3fbf.ts.net/mcp",
      "headers": {
        "Authorization": "Bearer ${TRACCIA_TOKEN}"
      }
    }
  }
}
```

Check it: `claude mcp get tracker` (or `claude mcp list`) should show it connected.

## 4. Codex

Codex reads `~/.codex/config.toml` (on Windows, `.codex\config.toml` in your user profile folder; a project can override it with `.codex/config.toml` in a trusted project). Add:

```toml
[mcp_servers.tracker]
url = "https://omni.tail2b3fbf.ts.net/mcp"
bearer_token_env_var = "TRACCIA_TOKEN"
```

`bearer_token_env_var` names the variable; Codex sends its value as the bearer token. The same snippet works on macOS and Windows, as long as `TRACCIA_TOKEN` is set in the environment that launches Codex. If you run Codex inside WSL, set the variable and the config inside WSL, which has its own home folder.

Check it: `codex mcp list`, or `/mcp` inside a Codex session.

## 5. OpenCode

OpenCode reads `~/.config/opencode/opencode.json` (or `opencode.jsonc`); on Windows that is `.config\opencode\opencode.json` in your user profile folder. A project can add its own `opencode.json` at the repo root. Add a remote server under `mcp`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tracker": {
      "type": "remote",
      "url": "https://omni.tail2b3fbf.ts.net/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer {env:TRACCIA_TOKEN}"
      }
    }
  }
}
```

`{env:TRACCIA_TOKEN}` is OpenCode's own substitution syntax (not `${...}`); it reads the variable when OpenCode loads the config, so the token is never stored in the file. If the file already has an `mcp` block, add only the `tracker` entry. The same snippet works on macOS and Windows, as long as `TRACCIA_TOKEN` is set in the environment that launches OpenCode.

Check it: `opencode mcp list` should show `tracker` as `connected`. If it says `needs authentication`, the server rejected the token (OpenCode treats a 401 as a request to start OAuth, which Traccia does not offer): fix the token as in Troubleshooting, do not run `opencode mcp auth`.

## 6. Environment variables and GUI-launched agents

Agents started from a desktop app, an IDE, or a launcher (rather than from a terminal) may not inherit variables set in `~/.zshrc` or similar shell profiles, so `TRACCIA_TOKEN` arrives empty and the server answers `401`. Either start the agent from a terminal that has the variable, or set it where the GUI can see it: on Windows the `User` scope above is enough after restarting the app; on macOS run `launchctl setenv TRACCIA_TOKEN '<paste the token>'` and restart the app (this does not survive a reboot).

## 7. Verify

Start a new agent session (environment changes apply only to new processes) and ask it to call `whoami`. Expect:

```json
{ "actor": "agent", "tokenName": "mac-claude" }
```

The `actor` and `tokenName` must match the token you created. The `tokenName` should follow the `<tool>-<machine>` convention above. Then ask for `list_projects` to confirm reads work.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Connection times out or the host does not resolve | The machine is not on the tailnet. Traccia is reachable only from tailnet devices, so connect Tailscale and retry. |
| `401 Unauthorized` | The token is wrong, revoked, or empty. Check `echo $TRACCIA_TOKEN` (`$env:TRACCIA_TOKEN` on Windows) in the shell that launches the agent, and that the variable name matches the config. Remember a restarted agent is needed after setting it. If the header was added with double quotes, your shell may have expanded it at add time; re-add it with single quotes. Confirm the token with `tracker token list`, or mint a new one. |
| `needs authentication` in `opencode mcp list` | Same as `401`: the token is empty or wrong. See the `401` row, and check `{env:TRACCIA_TOKEN}` is spelled exactly that way. |
| `429 Too Many Requests` | The token exceeded its per-minute request limit (default 120 per minute). The response carries a `Retry-After` header; wait that long, and avoid tight loops; use `list_issues` filters and `limit` instead of fetching everything. |
| Tools listed but a call fails with `Agents cannot purge` or `forbidden` | Expected. Agents cannot purge unless the server has agent purge switched on, and deletes are soft and restorable. Ask the owner to purge from the dashboard. |

## Not supported in v1

Traccia is tailnet-only. These runtimes cannot reach it and are intentionally unsupported:

- CI runners
- Cloud-hosted agents
- Phones
- claude.ai connectors (they connect from Anthropic's servers, not from your tailnet)

Agents in these places should report to you, and you record the outcome in the dashboard.

## Verification status

The Claude Code and Codex steps are checked against their official docs, and the OpenCode config was checked to parse in OpenCode 1.18 on macOS (`opencode debug config`, `opencode mcp list`). None of the tool and machine combinations have yet been confirmed end to end with `whoami` using a real token (the Windows PowerShell quoting and the Codex snippet in particular). When you connect one, correct this page if a step did not work as written.
