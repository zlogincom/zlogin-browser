# @zlogin/cli

Windows-first ZLogin Runtime CLI on the `cli` branch. Commands expose stable JSON/human output while Runtime and Open API integration is added incrementally.

```text
zlogin version
zlogin doctor [--json]
zlogin runtime status [--json]
zlogin runtime start [--json]
zlogin runtime stop [--json]
zlogin runtime update [--json]
zlogin login [--no-browser] [--timeout <seconds>] [--json]
zlogin logout [--json]
zlogin auth status [--json]
zlogin profile list [--json]
zlogin profile start <profileCode> [--json]
zlogin profile status <profileCode> [--json]
zlogin profile stop <profileCode> [--json]
```

`runtime update` reads `ZLOGIN_RUNTIME_RELEASES_URL` and optional `ZLOGIN_RUNTIME_CHANNEL`, verifies the HTTPS release manifest, downloads the artifact, checks its size, SHA-256 and Ed25519 signature, extracts it through a path-checked `tar` archive, and atomically updates the current pointer. The trusted public key is supplied through `ZLOGIN_RUNTIME_PUBLIC_KEY`; `ZLOGIN_RUNTIME_PUBLIC_KEY_ID` can pin the manifest key id.

Exit codes: `0` success, `1` invalid/unknown command, `2` unavailable, unconfigured, or failed Runtime installation.

`runtime start` reads the installed manifest `entryPoint` (or a platform default), launches the Runtime with an endpoint-file contract, then waits for a loopback health response. `runtime stop` sends an authenticated local shutdown request and removes stale endpoint state after the process exits.

`login`, `logout`, and `auth status` call the authenticated local Runtime control protocol. The CLI displays only the verification URL, user code, and final identity summary; cloud refresh tokens remain owned by the Runtime and are never returned in CLI output.

Profile commands use the local Open API. Configure it with `ZLOGIN_OPENAPI_URL` (defaults to `http://127.0.0.1:50025`) and `ZLOGIN_OPENAPI_KEY`. The URL must use loopback HTTP, and the API key is never accepted as a command argument.
