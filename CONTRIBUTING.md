# Contributing

This repository contains the ZLogin MCP server, shared core contracts, agent skill, and the planned CLI.

Before contributing:

- Do not commit API keys, customer data, cookies, account secrets, proxy credentials, or private binaries.
- Keep shared API semantics in `packages/core` and avoid duplicating contracts in the CLI or MCP adapters.
- Add or update tests for behavioral changes.
- Run `pnpm install`, `pnpm run check`, and `pnpm run format:check` before opening a pull request.

The CLI remains a next-version target. The repository license and contribution model must be finalized before publishing packages or describing the project as open source.
