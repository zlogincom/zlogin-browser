# ZLogin Public Ecosystem

This repository is the planned public home for ZLogin integrations that can be distributed independently from the ZLogin desktop client.

The intended public surface includes:

- `packages/core`: shared API contracts, types, request helpers, and capability metadata.
- `packages/cli`: a command-line interface for local ZLogin operations.
- `packages/mcp`: an MCP server for AI clients.
- `skills/`: reusable agent skills that route natural-language requests to the CLI or MCP tools.
- `docs/`: architecture, security, contribution, and release documentation.

The ZLogin desktop application, browser kernels, cloud services, account data, credentials, and server-side implementation are outside this repository.

## Repository Status

This repository is an initial scaffold. The package directories define ownership boundaries; implementation will be moved or added incrementally after the public API and licensing decisions are finalized.

The repository is intentionally marked `UNLICENSED` for now. Choose and add a license before making the repository public or describing the contents as open source. See [docs/PUBLIC-RELEASE-CHECKLIST.md](docs/PUBLIC-RELEASE-CHECKLIST.md).

## Layout

```text
packages/
  core/       Shared contracts and common helpers
  cli/        User-facing command-line interface
  mcp/        Model Context Protocol server
skills/
  zlogin-browser/  Agent instructions and workflow references
docs/
  ARCHITECTURE.md
  PUBLIC-RELEASE-CHECKLIST.md
```

## Development

Requirements:

- Node.js 20 or later
- pnpm 10 or later

```bash
pnpm install
pnpm run check
```

No API key, desktop client, or live ZLogin environment is required for the scaffold checks.

## Scope Boundary

This repository will contain adapters and public contracts for the ZLogin product. It must not contain API keys, customer data, cookies, proxy passwords, account secrets, private client binaries, or server credentials.
