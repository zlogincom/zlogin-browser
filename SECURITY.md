# Security Policy

This repository will contain public integration code for ZLogin. It must not contain API keys, customer data, cookies, account secrets, proxy passwords, private client binaries, or production service credentials.

## Reporting a Vulnerability

Do not open a public issue for a vulnerability or include secrets in an issue, pull request, log, screenshot, or test fixture. Before the repository is made public, configure GitHub private vulnerability reporting or add a monitored security contact here.

## Runtime Boundary

The CLI and MCP packages are local adapters for the ZLogin desktop client. They do not replace server-side authorization, resource scope, rate limits, audit controls, or user confirmation. Remote deployment, if ever added, requires a separate security review covering authentication, tenant isolation, CSRF, origin validation, DNS rebinding, rate limiting, auditing, and managed secret storage.
