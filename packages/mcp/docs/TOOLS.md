# Tool Catalog

This catalog is generated from `assets/openapi.json` as of 2026-08-24. Tool counts and arguments may change when the Open API contract is updated.

## Open API Tools (75)

### Status and Browser Runtime (15)

`check-status`, `get-api-context`, `get-capabilities`, `get-browser-list`, `get-browser`, `open-browser`, `close-browser`, `show-browser`, `get-browser-active`, `get-opened-browser`, `get-browser-connection`, `get-browsers-active`, `open-browsers`, `close-browsers`, `close-all-profiles`

### Profile Configuration and Fingerprints (13)

`get-browser-environment-options`, `create-browser`, `update-browser`, `move-browsers`, `delete-browsers`, `replace-browser-tags`, `set-browser-proxy`, `get-browser-fingerprint`, `update-browser-fingerprint`, `get-browser-advanced-settings`, `update-browser-advanced-settings`, `generate-user-agent`, `generate-webgl`

### Extensions (8)

`get-extension-category-list`, `get-extension-list`, `get-extension-package-list`, `create-extension-package`, `update-extension-package-status`, `delete-extension-package`, `get-browser-extensions`, `update-browser-extensions`

### Trash, Cookies, Accounts, and Startup Pages (13)

`get-trash-browser-list`, `restore-browsers`, `purge-browsers`, `get-browser-cookies`, `replace-browser-cookies`, `update-browser-cookies`, `get-account-platform-list`, `get-browser-accounts`, `replace-browser-accounts`, `update-browser-accounts`, `get-browser-startup-pages`, `replace-browser-startup-pages`, `update-browser-startup-pages`

### Groups and Profile Tags (11)

`get-group-list`, `create-group`, `update-group`, `delete-group`, `merge-groups`, `pin-group`, `unpin-group`, `get-tag-list`, `create-tag`, `update-tag`, `delete-tags`

### Proxies and Proxy Tags (10)

`get-proxy-list`, `create-proxies`, `get-proxy`, `update-proxy`, `delete-proxies`, `check-proxy`, `get-proxy-tag-list`, `create-proxy-tag`, `update-proxy-tag`, `delete-proxy-tags`

### Browser Kernel Packages (5)

`get-kernel-list`, `download-kernel`, `get-kernel-task`, `install-kernel`, `delete-kernel`

## Automation Tools (21)

### Sessions and Pages (8)

`connect-browser`, `connect-browser-with-ws`, `get-browser-sessions`, `select-browser-session`, `get-page-list`, `select-page`, `open-new-page`, `close-page`

### Page Reading and Interaction (13)

`navigate`, `screenshot`, `get-page-visible-text`, `get-page-html`, `click-element`, `fill-input`, `select-option`, `hover-element`, `scroll-element`, `press-key`, `evaluate-script`, `drag-element`, `iframe-click-element`
