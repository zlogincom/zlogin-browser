# ZLogin Tool Intent Map

Use this map to translate user language into the exact MCP tool name. The live MCP `tools/list` result and each tool's input schema are authoritative.

## Service and Profile Runtime

| User intent or trigger                   | MCP tool                                       | Important note                                                  |
| ---------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| 检测 API、服务是否可用、health check     | `check-status`                                 | Read-only local availability check.                             |
| 查看 API Key 上下文、权限、能力          | `get-api-context`, `get-capabilities`          | Use for permission or feature diagnostics.                      |
| 打开环境、启动 profile、拉起指纹浏览器   | `open-browser`                                 | Existing profile; pass exactly one selector.                    |
| 启动并直接自动化环境                     | `connect-browser`                              | Starts or reuses the profile and attaches a Playwright session. |
| 关闭环境、停止 profile                   | `close-browser`                                | Pass exactly one selector.                                      |
| 关闭本机所有环境                         | `close-all-profiles`                           | Broad shutdown; confirm unless explicitly requested.            |
| 查看环境列表、搜索环境、列出所有 profile | `get-browser-list`                             | Respect `pageNumber`/`pageSize`; collect all pages for “all”.   |
| 查看本机已打开环境                       | `get-opened-browser`                           | Local runtime state only.                                       |
| 查看单个环境详情                         | `get-browser`                                  | Selector-based detail; useful before updates.                   |
| 查看环境运行状态或 CDP 连接              | `get-browser-active`, `get-browser-connection` | The connection tool is for an already-open environment.         |
| 批量查询运行状态                         | `get-browsers-active`                          | Use selector objects in `profiles`.                             |
| 批量启动或关闭环境                       | `open-browsers`, `close-browsers`              | Each item in `profiles` is one explicit selector.               |
| 显示已运行环境窗口                       | `show-browser`                                 | Does not start a new environment.                               |

## Profile Configuration

| User intent or trigger           | MCP tool                                                            | Important note                                                             |
| -------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 新建环境、创建 profile           | `create-browser`                                                    | Required: `name`, `browser`, `browserVersion`, `os`; use `idempotencyKey`. |
| 修改名称、备注、浏览器或系统字段 | `update-browser`                                                    | Read first and pass `ifMatch`.                                             |
| 移动环境到分组、批量归类         | `move-browsers`                                                     | Resolve the target group UUID first.                                       |
| 替换环境标签                     | `replace-browser-tags`                                              | This replaces the complete tag-code list.                                  |
| 绑定或解绑代理                   | `set-browser-proxy`                                                 | Use `proxyId: null` to unbind when supported by the schema.                |
| 查看或更新持久指纹               | `get-browser-fingerprint`, `update-browser-fingerprint`             | Read first; updates require the profile ETag.                              |
| 查看或更新高级设置               | `get-browser-advanced-settings`, `update-browser-advanced-settings` | Patch leaf settings with the profile ETag.                                 |
| 生成 UA 或 WebGL 候选            | `generate-user-agent`, `generate-webgl`                             | Candidate generation is read-only; persist only with an explicit update.   |

## Groups, Tags, Proxies, and Data

| User intent or trigger         | MCP tool                                                                                     | Important note                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 查看/新建/修改/删除分组        | `get-group-list`, `create-group`, `update-group`, `delete-group`                             | Delete only unused groups. Creates require `idempotencyKey`.     |
| 合并、置顶、取消置顶分组       | `merge-groups`, `pin-group`, `unpin-group`                                                   | Resolve group UUIDs; confirm merges if scope is ambiguous.       |
| 查看/新建/修改/删除环境标签    | `get-tag-list`, `create-tag`, `update-tag`, `delete-tags`                                    | Codes are lowercase kebab-case; deletion is blocked when in use. |
| 查看/新建/修改/删除代理        | `get-proxy-list`, `get-proxy`, `create-proxies`, `update-proxy`, `delete-proxies`            | Never expose proxy passwords in summaries.                       |
| 检测代理                       | `check-proxy`                                                                                | Can check a saved `proxyId` or an inline proxy object.           |
| 查看/新建/修改/删除代理标签    | `get-proxy-tag-list`, `create-proxy-tag`, `update-proxy-tag`, `delete-proxy-tags`            | Resolve codes before mutation.                                   |
| 读取/整体替换/增量更新 Cookie  | `get-browser-cookies`, `replace-browser-cookies`, `update-browser-cookies`                   | Updates require the cookie ETag; treat values as secrets.        |
| 查看/整体替换/增量更新账号模块 | `get-browser-accounts`, `replace-browser-accounts`, `update-browser-accounts`                | Password and 2FA fields are write-only and must not be echoed.   |
| 查看/整体替换/增量更新启动页   | `get-browser-startup-pages`, `replace-browser-startup-pages`, `update-browser-startup-pages` | `replace` overwrites all URLs; URLs must be valid.               |

## Extensions, Trash, and Kernels

| User intent or trigger                     | MCP tool                                                                                   | Important note                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 查看扩展分类、扩展、Web Store 包           | `get-extension-category-list`, `get-extension-list`, `get-extension-package-list`          | Start with read-only catalog tools.                            |
| 添加、启停、删除扩展包                     | `create-extension-package`, `update-extension-package-status`, `delete-extension-package`  | Verify the package and scope before mutation.                  |
| 查看环境扩展绑定、更新绑定                 | `get-browser-extensions`, `update-browser-extensions`                                      | Profile-specific configuration.                                |
| 移入回收站、查看回收站、恢复环境           | `delete-browsers`, `get-trash-browser-list`, `restore-browsers`                            | `delete-browsers` is reversible trash, not permanent deletion. |
| 永久删除回收站环境                         | `purge-browsers`                                                                           | Requires `confirmed: true`; always confirm ambiguous requests. |
| 查看、下载、查询任务、安装、卸载浏览器内核 | `get-kernel-list`, `download-kernel`, `get-kernel-task`, `install-kernel`, `delete-kernel` | Download/install are asynchronous; poll the task tool.         |

## Browser Page Automation

| User intent or trigger             | MCP tool                                                                                       | Important note                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 用返回的 ws 连接自动化             | `connect-browser-with-ws`                                                                      | Only loopback `ws://`/`wss://` endpoints.                        |
| 查看自动化会话、切换会话           | `get-browser-sessions`, `select-browser-session`                                               | Use `sessionId` explicitly when multiple profiles are connected. |
| 查看/切换/新建/关闭标签页          | `get-page-list`, `select-page`, `open-new-page`, `close-page`                                  | Use stable `pageId`; closing a page is destructive.              |
| 打开 URL、读取页面                 | `navigate`, `get-page-visible-text`, `get-page-html`, `screenshot`                             | Navigate only to absolute HTTP(S) URLs.                          |
| 点击、填写、选择、悬停、滚动、按键 | `click-element`, `fill-input`, `select-option`, `hover-element`, `scroll-element`, `press-key` | Prefer stable CSS selectors and verify state after actions.      |
| 执行页面 JS、拖拽、iframe 点击     | `evaluate-script`, `drag-element`, `iframe-click-element`                                      | May cause external side effects; bound outputs are truncated.    |
