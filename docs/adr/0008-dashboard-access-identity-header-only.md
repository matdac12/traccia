# Dashboard access is a Tailscale identity-header check, with no password fallback up front

The dashboard compares `Tailscale-User-Login` with `DASHBOARD_ALLOWED_LOGINS`. This is safe only because the web service listens on localhost behind `tailscale serve`. A password login with a signed cookie is built only if the deploy phase finds the header missing from Mac or Windows. Another local process on `<your-server>` could forge the header; we accept that for v1 and document it in the README.
