---
name: zlogin-browser
description: "Manage ZLogin browser profiles and automate pages through the local zlogin-mcp server. Use for profile, group, tag, proxy, cookie, account, startup-page, extension, kernel, session, tab, navigation, and page-action requests. Do not use for remote MCP transport, headless startup, or unsupported RPA workflows."
---

# ZLogin Browser

Use the local stdio `@zlogin/mcp` server (binary `zlogin-mcp`) to operate the user's local ZLogin desktop client. The server exposes two layers:

- Management tools for profiles, runtime state, fingerprints, advanced settings, groups, tags, proxies, cookies, accounts, startup pages, extensions, trash, and browser kernels.
- Automation tools for CDP-connected browser sessions and pages.

This skill is project-local until the repository publishes a standalone skill package. It must not invent a CLI command or substitute a remote API. The MCP server's live `tools/list` response takes precedence over this guide when a client version changes.

## Before Operating

- ZLogin must be running, Local Open API must be enabled, and the MCP process must have `ZLOGIN_API_KEY` configured.
- If availability is unknown, call `check-status` first. Use `get-api-context` and `get-capabilities` when diagnosing permissions or supported operations. If the server itself cannot start, verify `ZLOGIN_API_KEY` and the local API URL in the MCP client's process environment.
- Use MCP tools directly. Do not invent REST routes, undocumented fields, shell commands, or a remote transport.
- Read current state before a mutation when the request does not already identify the exact current resource.

## Route User Intent

- “打开环境 / 启动 profile” means start an existing profile with `open-browser`. If the user also wants page control, use `connect-browser`, which starts or reuses the profile and attaches Playwright in one step.
- “关闭环境” maps to `close-browser`; “全部关闭” maps to `close-all-profiles`.
- “列出/搜索环境” maps to `get-browser-list`; “查看本机已打开环境” maps to `get-opened-browser`.
- “新建环境” maps to `create-browser`. Resolve valid browser, OS, and version choices with `get-browser-environment-options` when needed.
- “修改环境” maps to `update-browser`; use the narrower tool for fingerprints, advanced settings, tags, proxy binding, extensions, cookies, accounts, or startup pages.
- Group, tag, proxy, extension, trash, and kernel requests should use the corresponding `get-*`, `create-*`, `update-*`, `delete-*`, `restore-*`, `purge-*`, `download-*`, or `install-*` tool names exposed by the server. The authoritative list is [packages/mcp/docs/TOOLS.md](../../packages/mcp/docs/TOOLS.md); consult it when a tool name or schema is uncertain.
- For website interaction, connect first, then use `get-page-list`, `select-page`, `navigate`, inspection tools, and action tools. Read [references/workflows.md](references/workflows.md) for the standard sequences.

## Minimal Routing Examples

- “列出环境并打开 customer-001”：call `get-browser-list` if the code is not already known, then `open-browser` with exactly one selector.
- “打开网站并读取标题”：call `connect-browser`, inspect with `get-page-list`, then `navigate` and `get-page-visible-text` or `get-page-html`.
- “把环境移到分组”：resolve the group with `get-group-list`, resolve the profile with `get-browser-list`, then call `move-browsers` with the returned IDs.
- “删除环境”：use `delete-browsers` for reversible trash; reserve `purge-browsers` for explicitly confirmed permanent deletion.

## Operating Rules

- Profile selectors are explicit and mutually exclusive: provide exactly one of `profileId`, `profileNo`, or `profileCode`. Prefer `profileCode` when it is the stable identifier the user knows.
- MCP argument names are camelCase. Header values are passed as `idempotencyKey` and `ifMatch` arguments, not as arbitrary headers.
- For create and batch mutation tools whose schema requires `idempotencyKey`, generate a new stable key for the logical operation and reuse it only when retrying that same operation.
- For profile, fingerprint, advanced-settings, cookie, account, and startup-page updates, read the resource first and pass the returned ETag as `ifMatch`. Preserve the exact quoted value; a stale ETag should be reported as a conflict, not bypassed.
- `replace-*` operations overwrite the complete collection or module. `update-*` operations merge or patch. Never omit existing values when the user asked to preserve them.
- Resolve names to IDs or codes before writes: list groups, tags, proxies, extensions, or kernels first when the user supplied only a human label.
- Ask for confirmation immediately before permanent deletion or broad shutdown: `purge-browsers`, deleting groups/tags/proxies/kernels, `close-all-profiles`, or closing many pages. A user instruction that explicitly requests the destructive action is sufficient confirmation.
- Treat cookies, account passwords, proxy credentials, two-factor secrets, and page contents as sensitive. Do not echo secrets or include them in summaries unless the user explicitly needs the value.
- Automation URLs must be absolute `http://` or `https://` URLs. `connect-browser-with-ws` accepts only loopback WebSocket endpoints returned by ZLogin; never connect to a user-supplied remote host.
- `click-element`, `fill-input`, `press-key`, `evaluate-script`, drag/drop, iframe clicks, and page closing can cause external side effects. Confirm ambiguous actions and report what changed.

## Failure Handling

- Return the MCP error message and stable error code when a call fails; do not retry mutations automatically.
- For `429`, timeout, or transport failures, retry only a read-only call when the operation is safe and the server's retry metadata permits it.
- For `If-Match` conflicts, re-read the resource and ask whether to apply the change to the newer revision.
- For asynchronous kernel downloads, poll `get-kernel-task` to a terminal state and stop after a bounded number of polls.

## References

- Read [references/tool-intent-map.md](references/tool-intent-map.md) when routing a natural-language request to an MCP tool.
- Read [references/workflows.md](references/workflows.md) for exact multi-step recipes, selector rules, ETag handling, pagination, and automation session management.

The complete generated MCP catalog remains in the repository at `packages/mcp/docs/TOOLS.md`; the live `tools/list` response is authoritative when the API contract changes.
