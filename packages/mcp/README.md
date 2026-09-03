# zlogin-mcp

Local stdio Model Context Protocol server for the ZLogin desktop client, modeled as a narrow adapter over the bundled ZLogin OpenAPI contract.

It exposes 75 Open API tools and, by default, 21 Playwright/CDP automation tools. Input schemas are generated from the bundled OpenAPI 3.1 document; successful responses retain request IDs, ETags, and rate-limit metadata.

## Run From This Repository

```powershell
pnpm install
pnpm --filter zlogin-mcp build
$env:ZLOGIN_API_KEY = "replace-with-your-api-key"
node packages/mcp/dist/index.js
```

Configure an MCP client to run that `dist/index.js` path over stdio. Set `ZLOGIN_BASE_URL` to override `http://127.0.0.1:50025`, `ZLOGIN_TIMEOUT_MS` for request timeout, and `ZLOGIN_ENABLE_AUTOMATION=false` to expose only management tools.

Example client configuration:

```json
{
	"mcpServers": {
		"zlogin": {
			"command": "node",
			"args": ["C:/absolute/path/to/packages/mcp/dist/index.js"],
			"env": {
				"ZLOGIN_API_KEY": "replace-with-your-api-key",
				"ZLOGIN_BASE_URL": "http://127.0.0.1:50025",
				"ZLOGIN_ENABLE_AUTOMATION": "true"
			}
		}
	}
}
```

The process does not load `.env` files. Inject credentials through the MCP client's process environment and never pass them as tool arguments.

See [docs/TOOLS.md](./docs/TOOLS.md) for the generated tool catalog and the repository skill at `skills/zlogin-browser` for safe operating workflows.

## Version Compatibility

The tool catalog follows the OpenAPI document shipped in this package. A tool may return `NOT_FOUND` or an equivalent client error when the installed ZLogin desktop version predates that operation. Upgrade the desktop client to a compatible version before retrying. The live MCP `tools/list` response is authoritative for the running server.

## Common Flows

1. Check availability with `check-status`.
2. List or resolve a profile with `get-browser-list` and use exactly one of `profileId`, `profileNo`, or `profileCode`.
3. Use `open-browser` for launch-only requests, or `connect-browser` when page automation is required.
4. Read state before updates and pass the returned ETag as `ifMatch`.
5. For kernel downloads, poll `get-kernel-task` until a terminal state.

For destructive operations, confirm the scope immediately before execution unless the user explicitly requested that exact action.
