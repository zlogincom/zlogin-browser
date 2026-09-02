# ZLogin Workflows

These recipes describe the safest common sequences. Use the live MCP schemas for optional fields and current enum values.

## Start an Environment and Automate It

Use the one-step automation tool when the user wants to control a page:

```json
{
	"profileCode": "customer-001",
	"startupUrls": ["https://example.com"],
	"windowMode": "last-position"
}
```

1. Call `connect-browser` with exactly one of `profileId`, `profileNo`, or `profileCode`.
2. Save the returned `sessionId` and `activePageId`.
3. Call `get-page-list` with that `sessionId`. If the requested tab is not active, call `select-page` with its `pageId`.
4. Use `navigate`, `get-page-visible-text`, `get-page-html`, or `screenshot` to inspect the page before acting.
5. Use the smallest action tool that satisfies the request, then re-read page state to verify the result.

For a two-step API-style connection, call `open-browser` first, read `structuredContent.data.automation.webSocketDebuggerUrl`, then pass that exact loopback URL to `connect-browser-with-ws`.

## Resolve and Start a Profile

When the user gives a name, custom number, or partial description rather than an ID/code:

1. Call `get-browser-list` with a narrow filter and a useful page size.
2. If multiple profiles match, ask which one to use; do not guess.
3. Use the selected profile's stable `profileCode` or numeric `profileId` in `open-browser` or `connect-browser`.

The selector is never a mixture. An input containing both `profileId` and `profileCode` is invalid.

## Create a Profile

1. Call `get-browser-environment-options` if the browser, operating system, or version is not already known to be valid.
2. Call `create-browser` with the required profile fields and a fresh `idempotencyKey`:

```json
{
	"name": "客服测试环境",
	"browser": "Chrome",
	"browserVersion": "<value from environment options>",
	"os": "Windows",
	"proxySource": "none",
	"idempotencyKey": "zlogin-profile-create-<unique-key>"
}
```

3. Report the returned profile identifiers. Do not start the profile unless the user asked for it.

If the user supplies a group, tag, proxy, fingerprint, or advanced settings, resolve referenced IDs/codes and validate the values with the corresponding read tool before including them.

## Update a Profile Safely

1. Call `get-browser` with exactly one profile selector.
2. Read the current value and the returned `structuredContent.meta.etag`.
3. Call the narrowest update tool. For basic fields, use `update-browser` with `profileId`, the changed fields, and `ifMatch` set to the exact ETag.
4. If the tool reports an ETag conflict, re-read the profile and ask whether to apply the change to the new revision. Never overwrite a concurrent update blindly.

The same read-then-ETag pattern applies to `update-browser-fingerprint`, `update-browser-advanced-settings`, `replace-browser-cookies`, `update-browser-cookies`, `replace-browser-accounts`, `update-browser-accounts`, `replace-browser-startup-pages`, and `update-browser-startup-pages`.

## Move or Operate on Many Profiles

For “all profiles”, “all profiles in group X”, or similar requests:

1. Call `get-browser-list` and follow pagination until the response's `totalCount` is collected. Keep the same filters on every page.
2. Present the resolved count and scope if the operation is destructive or broad.
3. Use a batch tool with the returned IDs/selectors: `move-browsers`, `open-browsers`, `close-browsers`, `get-browsers-active`, or `delete-browsers`.
4. Batch limits are enforced by the tool schema. Chunk requests and use a distinct idempotency key per logical batch when required.

`delete-browsers` moves profiles to trash. Permanent removal is a separate `purge-browsers` call and requires `confirmed: true`.

## Cookies, Accounts, and Startup Pages

- Read first with the relevant `get-browser-*` tool.
- Use `replace-*` only when the user supplied the complete desired collection/module.
- Use `update-*` for incremental changes and include both required patch collections when the schema asks for them.
- Pass the returned ETag in `ifMatch` exactly. Do not print passwords, two-factor secrets, proxy credentials, or full cookie values in the final summary.

## Proxy Workflow

1. Call `get-proxy-list` when the user refers to a saved proxy by name or title.
2. Use `check-proxy` before binding an unfamiliar proxy when the user asks to validate it.
3. Use `set-browser-proxy` to bind a saved numeric `proxyId`; use `proxyId: null` to unbind when the current schema allows it.
4. For new saved proxies, call `create-proxies` with `items` containing `proxyType`, `host`, and integer `port`, plus an `idempotencyKey`.

Do not put proxy passwords in logs or user-facing summaries.

## Browser Kernel Tasks

1. Call `get-kernel-list` to verify the browser/kernel/version combination.
2. Call `download-kernel` and save its returned task ID.
3. Poll `get-kernel-task` until the task reaches a terminal state; report failures without retrying indefinitely.
4. Call `install-kernel` only when installation was requested and the package is available.
5. Do not delete a kernel reported as in use; surface the dependency instead.

## Automation Details

- Omit `sessionId` only when there is one clear active session. With multiple sessions, pass it on every call.
- `pageId` values are session-local and stable until the page closes. Call `get-page-list` after navigation or popup activity when the target tab may have changed.
- Use `get-page-visible-text` or `get-page-html` to discover stable selectors before clicking or filling. Do not rely on guessed selectors when the page state is unknown.
- `open-new-page` and `navigate` accept absolute HTTP(S) URLs only. A WebSocket URL is accepted only by `connect-browser-with-ws` and must target loopback.
- `fill-input` does not echo the supplied value. Keep credentials out of follow-up summaries.
- `evaluate-script` results, text, HTML, and screenshots are bounded by the server. If output is truncated, narrow the selector or query rather than trying to bypass the limit.
