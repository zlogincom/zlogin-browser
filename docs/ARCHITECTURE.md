# Architecture

## Public Layers

### `packages/core`

Owns shared public contracts and helpers:

- API route and capability metadata
- TypeScript types and JSON schemas
- Request/response normalization
- Tool intent metadata shared by CLI, MCP, and skills

Core must remain independent from a particular AI client or terminal UI.

### `packages/cli`

Owns the command-line experience for local ZLogin operations. It may provide aliases, JSON input, shell completion, and human-readable output, but it must use the shared contracts from `core` rather than duplicating API semantics.

### `packages/mcp`

Owns the Model Context Protocol adapter. It should expose validated tools, structured results, and explicit annotations for read-only and destructive actions. It must not become a second undocumented API client.

### `skills/`

Owns agent-facing instructions. Skills route user intent to the CLI or MCP surface and document fragile workflows. They must not contain credentials or promise capabilities that the public packages do not implement.

## Private Product Boundary

The public repository is an integration layer. The following remain outside its scope unless separately approved:

- ZLogin desktop application source
- Browser kernels and proprietary binaries
- Cloud services and server-side authorization
- Customer profiles, cookies, accounts, proxy credentials, and audit data
- Production API keys and deployment secrets

## Dependency Direction

```text
core  <-  cli
core  <-  mcp
cli/mcp  <-  skills (documented usage, not a runtime dependency)
```

Keep product-specific adapters above `core`, and keep secrets in the local runtime environment rather than source control.
