# ZLogin MCP & Skill

Local MCP and agent skill integrations for the ZLogin desktop browser client.

The MCP server exposes the ZLogin Local Open API over stdio. The `zlogin-browser` skill teaches compatible agents how to select tools, preserve ETags, handle sensitive data, and automate connected pages safely.

The intended public surface includes:

- `packages/core`: shared API contracts, types, request helpers, and capability metadata.
- `packages/cli`: a command-line interface for local ZLogin operations.
- `packages/mcp`: an MCP server for AI clients.
- `skills/`: reusable agent skills that route natural-language requests to the CLI or MCP tools.
- `docs/`: architecture and release documentation.
- `SECURITY.md` and `CONTRIBUTING.md`: security and contribution boundaries.

The ZLogin desktop application, browser kernels, cloud services, account data, credentials, and server-side implementation are outside this repository.

## Quick Start

Requirements:

- ZLogin desktop client with Local Open API enabled
- Node.js 20 or later
- pnpm 10 or later

Build and start the local MCP server:

```bash
pnpm install
pnpm --filter zlogin-mcp build
ZLOGIN_API_KEY=replace-with-your-api-key node packages/mcp/dist/index.js
```

For Windows PowerShell:

```powershell
$env:ZLOGIN_API_KEY = "replace-with-your-api-key"
node packages/mcp/dist/index.js
```

Add the server to an MCP client using the absolute path to `packages/mcp/dist/index.js`:

```json
{
	"mcpServers": {
		"zlogin": {
			"command": "node",
			"args": ["C:/absolute/path/to/zlogin-github-public/packages/mcp/dist/index.js"],
			"env": {
				"ZLOGIN_API_KEY": "replace-with-your-api-key",
				"ZLOGIN_BASE_URL": "http://127.0.0.1:50025",
				"ZLOGIN_ENABLE_AUTOMATION": "true"
			}
		}
	}
}
```

Install the skill from a checkout by placing `skills/zlogin-browser` in the agent's skills directory, or use the repository directly when the agent supports project-local skills. The skill entrypoint is [skills/zlogin-browser/SKILL.md](skills/zlogin-browser/SKILL.md).

## What Is Included

`packages/mcp` contains:

- 75 OpenAPI-driven management tools for profiles, runtime state, fingerprints, settings, groups, tags, proxies, cookies, accounts, startup pages, extensions, trash, and browser kernels.
- 21 Playwright/CDP tools for sessions, pages, navigation, inspection, screenshots, input, keyboard, drag/drop, iframes, and script evaluation.
- Structured responses with request IDs, ETags, rate-limit metadata, and stable error details.
- Read-only, action, and destructive MCP annotations so clients can make better confirmation decisions.

The CLI package is intentionally not implemented yet and is the next-version target.

The repository is intentionally marked `UNLICENSED` for now. Choose and add a license before making the repository public or publishing packages. See [docs/PUBLIC-RELEASE-CHECKLIST.md](docs/PUBLIC-RELEASE-CHECKLIST.md).

## Capability Boundaries

- Local stdio transport only. No remote MCP listener is included.
- No headless ZLogin startup, RPA engine, profile sharing, or server-side authorization bypass.
- API keys are read from the MCP process environment and are never tool arguments.
- Cookies, account passwords, proxy credentials, two-factor secrets, and page contents are sensitive; the server bounds or suppresses them in results.
- Permanent deletion, broad shutdown, and page actions are explicitly annotated and should be confirmed when the request is ambiguous.

See [packages/mcp/docs/TOOLS.md](packages/mcp/docs/TOOLS.md), [skills/zlogin-browser/references/tool-intent-map.md](skills/zlogin-browser/references/tool-intent-map.md), and [skills/zlogin-browser/references/workflows.md](skills/zlogin-browser/references/workflows.md).

## Repository Layout

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

For package-specific configuration, development commands, and release notes, see [packages/mcp/README.md](packages/mcp/README.md).

No API key, desktop client, or live ZLogin environment is required for the scaffold checks.

## Scope Boundary

This repository will contain adapters and public contracts for the ZLogin product. It must not contain API keys, customer data, cookies, proxy passwords, account secrets, private client binaries, or server credentials.
