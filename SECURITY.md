# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include what you found, how to reproduce it and the impact you think it has. The maintainer will acknowledge the report and follow up there.

## Design notes

Traccia is built to run on a private Tailscale network and nowhere else. A few properties matter when you assess a report:

- Nothing binds to a public interface. `tailscale serve` is the only thing that publishes the api and the dashboard, and Tailscale Funnel stays off.
- Two actors only, `you` and `agent`. Bearer tokens are stored hashed, shown once and revoked immediately. There is no public token endpoint.
- Dashboard access trusts the `Tailscale-User-Login` header that `tailscale serve` adds ([ADR 0008](docs/adr/0008-dashboard-access-identity-header-only.md)). Another process on the host could forge it. That is a known and accepted trade-off, revisited if the host ever runs third-party code.
- Deletes are soft and restorable. Agents cannot purge issues and other tracker data; memories and documents are the exception.

A self-signed `localhost` certificate is committed at `apps/api/test/fixtures/test-key.pem` and used only by tests. It is not a secret; it is allowlisted in [`.gitleaks.toml`](.gitleaks.toml).

## Supported versions

Traccia is pre-1.0 and has no released versions yet. Fixes land on `main`.
