# Connecting agents to Traccia

How to connect Claude Code, Codex and OpenCode to the Traccia MCP server from a Mac or a Windows machine. Both must be on the tailnet. Once connected, agents follow the workflow in [agent-snippet.md](agent-snippet.md) and use the tools listed in [mcp-tools.md](mcp-tools.md).

- Endpoint: `https://<your-tailnet-host>/mcp`
- Auth: `Authorization: Bearer <token>`. Keep the repo free of real tokens. Each tool reads the token its own way: OpenCode from a small file next to its config (`{file:...}`), Codex and Claude Code from a literal header in their own per-machine config, or any of them from a `TRACCIA_TOKEN` environment variable. GUI-launched apps often do not inherit shell variables, so the file or literal header is the reliable default here; see [Section 2](#2-store-the-token-per-tool).

## 1. Get a token

Create one token per machine and agent, so writes are attributed correctly and one machine can be revoked alone. On the server (the host that runs the `api` container, see [backup-restore.md](backup-restore.md) for how it is deployed):

```bash
cd /opt/tracker && docker compose exec -T api node dist/traccia.js token create --name mac-claude --actor agent
```

The plaintext is printed once and cannot be shown again. Use `--actor agent` for agents. Only the dashboard's own token is `you`. Run `token list` (no secrets shown) and `token revoke <id>` the same way, replacing `token create ...`; revoking cuts a token off immediately.

Name each token `<tool>-<machine>`, one per tool and machine, for example `claude-code-mac`, `codex-windows`, `opencode-mac` or `opencode-windows`. The name shows up as `tokenName` in `whoami` and in write attribution, and lets you revoke one tool on one machine alone.

If you use the optional environment variable, name it `TRACCIA_TOKEN`. Claude Code reads some credential names (such as `ANTHROPIC_AUTH_TOKEN` or `NPM_TOKEN`) as empty inside MCP headers, so avoid those names.

## 2. Store the token per tool

Traccia only checks the `Authorization` header. Pick one of these per tool and machine:

- **File reference (OpenCode).** Write the token to a small file next to the OpenCode config and reference it as `{file:./traccia-token}`. Nothing secret sits in the config, and GUI-launched OpenCode reads it. See [Section 5](#5-opencode).
- **Literal header (Codex, Claude Code).** Put `Authorization = "Bearer <token>"` directly in that tool's own per-machine config. Simplest, and it works on every launch; the trade-off is the token is stored in plain text in that file (the decision taken in MAT-1764). See [Section 4](#4-codex).
- **Environment variable (optional).** All three tools can read `TRACCIA_TOKEN` from the environment instead, but a desktop app or IDE launcher often does not inherit shell variables and the server then answers `401`. If you set it:

  ```bash
  # macOS: add to ~/.zshrc (or the profile your agent's shell loads), then open a new terminal
  export TRACCIA_TOKEN='<paste the token>'
  ```

  ```powershell
  # Windows (PowerShell): persist for your user, then open a new terminal
  [Environment]::SetEnvironmentVariable('TRACCIA_TOKEN', '<paste the token>', 'User')
  ```

## 3. Claude Code

Use single quotes so your shell keeps `${TRACCIA_TOKEN}` as text. Claude Code expands it from the environment each time it starts, so the token is never stored in the config.

### macOS

```bash
claude mcp add --transport http --scope user traccia https://<your-tailnet-host>/mcp \
  --header 'Authorization: Bearer ${TRACCIA_TOKEN}'
```

### Windows (PowerShell)

```powershell
claude mcp add --transport http --scope user traccia https://<your-tailnet-host>/mcp --header 'Authorization: Bearer ${TRACCIA_TOKEN}'
```

`--scope user` makes the server available in every project. Use `--scope project` to write a `.mcp.json` into one repo instead; that file can be committed because it holds only the `${TRACCIA_TOKEN}` placeholder:

```json
{
  "mcpServers": {
    "traccia": {
      "type": "http",
      "url": "https://<your-tailnet-host>/mcp",
      "headers": {
        "Authorization": "Bearer ${TRACCIA_TOKEN}"
      }
    }
  }
}
```

Check it: `claude mcp get traccia` (or `claude mcp list`) should show it connected.

If Claude Code is launched from a GUI and does not see `TRACCIA_TOKEN`, put the token in literally instead (`--header 'Authorization: Bearer <paste the token>'`); that is the trade-off taken for `claude-code-mac` in MAT-1764. A `.mcp.json` with a literal token must not be committed.

## 4. Codex

Codex reads `~/.codex/config.toml` (on Windows, `.codex\config.toml` in your user profile folder; a project can override it with `.codex/config.toml` in a trusted project). Add a literal bearer header so it works from every launch, GUI included:

```toml
[mcp_servers.traccia]
url = "https://<your-tailnet-host>/mcp"

[mcp_servers.traccia.http_headers]
Authorization = "Bearer <paste the token>"
```

The token is stored in plain text in `config.toml`; that is the accepted trade-off (MAT-1764) and the reason no `TRACCIA_TOKEN` variable is needed. If you would rather keep it in the environment, replace the `http_headers` block with `bearer_token_env_var = "TRACCIA_TOKEN"` and set the variable in the shell that launches Codex. If you run Codex inside WSL, edit the config (or set the variable) inside WSL, which has its own home folder.

On Windows this appends the server without disturbing the rest of the file:

```powershell
$codex = Join-Path $env:USERPROFILE '.codex\config.toml'
Add-Content -Path $codex -Value @'

[mcp_servers.traccia]
url = "https://<your-tailnet-host>/mcp"

[mcp_servers.traccia.http_headers]
Authorization = "Bearer <paste the token>"
'@
```

Check it: `codex mcp list` should list `traccia` with auth `Bearer token`, or `/mcp` inside a Codex session. Verified end to end on Windows (Codex 0.160.0): `codex exec` calling `whoami` returned `{"actor":"agent","tokenName":"codex-windows"}`.

Codex also logs `` `mcp` is ignored `` if the config has an `[mcp]` table; that table is not a recognised setting in 0.160.0 and is harmless. Only the `[mcp_servers.*]` entries matter.

## 5. OpenCode

OpenCode reads `~/.config/opencode/opencode.json` (or `opencode.jsonc`); on Windows that is `.config\opencode\` in your user profile folder. A project can add its own `opencode.json` at the repo root. Add a remote server under `mcp`, with the token in a file next to the config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "traccia": {
      "type": "remote",
      "url": "https://<your-tailnet-host>/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer {file:./traccia-token}"
      }
    }
  }
}
```

`{file:./traccia-token}` is OpenCode's own substitution syntax (not `${...}`): it reads the file relative to the config file, so the token lives at `~/.config/opencode/traccia-token` (Windows `%USERPROFILE%\.config\opencode\traccia-token`) and never in the config. If the file already has an `mcp` block, add only the `traccia` entry.

Write the token file **without a trailing newline**:

```bash
# macOS
printf '%s' '<paste the token>' > ~/.config/opencode/traccia-token
chmod 600 ~/.config/opencode/traccia-token
```

```powershell
# Windows (PowerShell)
$dir = Join-Path $env:USERPROFILE '.config\opencode'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
[System.IO.File]::WriteAllText((Join-Path $dir 'traccia-token'), '<paste the token>')
```

Because the token comes from the file, it works from a GUI launch too, with no `TRACCIA_TOKEN` variable. If you prefer, `{env:TRACCIA_TOKEN}` works in the same position, but then the variable must be set in whatever environment launches OpenCode.

Check it: `opencode mcp list` should show `traccia` as `connected`. If it says `needs authentication`, the server rejected the token (OpenCode treats a 401 as a request to start OAuth, which Traccia does not offer): fix the token as in Troubleshooting, do not run `opencode mcp auth`. Verified end to end on OpenCode 1.18.34 on macOS (`opencode-mac`) and Windows native PowerShell (`opencode-windows`): `whoami` returned the expected `tokenName`.

## 6. GUI-launched agents

Agents started from a desktop app, an IDE, or a launcher (rather than from a terminal) may not inherit variables set in `~/.zshrc` or similar shell profiles, so an environment-based config (such as Claude Code's `${TRACCIA_TOKEN}` header) arrives empty and the server answers `401`. The file reference (OpenCode) and the literal header (Codex, and the `claude-code-mac` setup from MAT-1764) avoid this because nothing is read from the environment. If you must use the environment variable, set it where the GUI can see it: on Windows the `User` scope above is enough after restarting the app; on macOS run `launchctl setenv TRACCIA_TOKEN '<paste the token>'` and restart the app (this does not survive a reboot).

## 7. Verify

Start a new agent session (environment changes apply only to new processes) and ask it to call `whoami`. Expect:

```json
{ "actor": "agent", "tokenName": "opencode-mac" }
```

The `actor` and `tokenName` must match the token you created. The `tokenName` should follow the `<tool>-<machine>` convention above. Then ask for `list_projects` to confirm reads work.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Connection times out or the host does not resolve | The machine is not on the tailnet. Traccia is reachable only from tailnet devices, so connect Tailscale and retry. |
| `401 Unauthorized` | The token is wrong, revoked, or empty. Check `echo $TRACCIA_TOKEN` (`$env:TRACCIA_TOKEN` on Windows) in the shell that launches the agent, and that the variable name matches the config. Remember a restarted agent is needed after setting it. If the header was added with double quotes, your shell may have expanded it at add time; re-add it with single quotes. Confirm the token with `traccia token list`, or mint a new one. |
| `needs authentication` in `opencode mcp list` | Same as `401`: the token is empty or wrong. Check `{file:./traccia-token}` is spelled exactly that way, that the file exists next to the config, and that it has no trailing newline (a newline makes the header `Bearer <token>\n`, which the server rejects). |
| `opencode mcp list` prints the top-level help instead of the servers (Windows) | A PowerShell function or alias named `opencode` is shadowing the binary — common when a wrapper injects `--auto`. Call the real one (`& "$env:APPDATA\npm\node_modules\opencode-ai\bin\opencode.exe" mcp list`) or fix the wrapper so subcommands pass through unchanged. |
| Codex logs `` `mcp` is ignored `` | The `[mcp]` table is not a recognised setting in Codex 0.160.0. Harmless; the `[mcp_servers.*]` entries are what matter. |
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

Verified end to end with `whoami` on 2026-10-05:

| Tool | Machine | Token | Result |
| --- | --- | --- | --- |
| OpenCode 1.18.34 | macOS | `opencode-mac` | `opencode mcp list` shows `connected`; `whoami` → `{ "actor": "agent", "tokenName": "opencode-mac" }` |
| OpenCode 1.18.34 | Windows (native PowerShell) | `opencode-windows` | `opencode mcp list` shows `connected`; `whoami` → `opencode-windows` |
| Codex 0.160.0 | Windows (native PowerShell) | `codex-windows` | `codex mcp list` lists `traccia` as `Bearer token`; `codex exec` `whoami` → `codex-windows` |
| Claude Code | macOS | `claude-code-mac` | connected via a literal header (MAT-1764) |

Still unverified: Codex on macOS, and Claude Code on Windows end to end (the `claude-code-windows` token exists but has not been exercised here). The macOS `launchctl setenv` advice is general macOS knowledge, not tested here. When you connect another tool or machine, correct this page if a step did not work as written.
