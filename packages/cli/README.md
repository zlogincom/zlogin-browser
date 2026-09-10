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
zlogin kernel list [--json]
zlogin kernel ensure --browser-version <version> [--json]
zlogin kernel download status --task-id <taskId> [--json]
```

`runtime update` reads `ZLOGIN_RUNTIME_RELEASES_URL` and optional `ZLOGIN_RUNTIME_CHANNEL`, verifies the HTTPS release manifest, downloads the artifact, checks its size, SHA-256 and Ed25519 signature, extracts it through a path-checked `tar` archive, and atomically updates the current pointer. The trusted public key is supplied through `ZLOGIN_RUNTIME_PUBLIC_KEY`; `ZLOGIN_RUNTIME_PUBLIC_KEY_ID` can pin the manifest key id.

Runtime release manifests may include `entryPoint` and `artifactType` emitted by
the Client release builder. `entryPoint` is required to remain a relative path
inside the installed version; `artifactType` is metadata for `zip`, `tar`, or
`tar.gz` artifacts. Older manifests remain compatible and use the conventional
packaged executable names.

Exit codes: `0` success, `1` invalid/unknown command, `2` unavailable, unconfigured, or failed Runtime installation.

`runtime start` reads the installed manifest `entryPoint` (or a platform default), launches native entries directly and JavaScript entries with the CLI's Node executable, then waits for the loopback endpoint-file health contract. `runtime stop` sends an authenticated local shutdown request and removes stale endpoint state after the process exits.

`login`, `logout`, and `auth status` call the authenticated local Runtime control protocol. The CLI displays only the verification URL, user code, and final identity summary; cloud refresh tokens remain owned by the Runtime and are never returned in CLI output.
Runtime-backed commands reuse a healthy process and automatically start an installed Runtime when it is not running. If a control request loses its connection because that Runtime PID exits, the CLI starts one replacement and retries the request once; HTTP errors and live but unhealthy processes are never restarted automatically.

Profile commands use the local Open API. Configure it with `ZLOGIN_OPENAPI_URL` (defaults to `http://127.0.0.1:50025`) and `ZLOGIN_OPENAPI_KEY`. The URL must use loopback HTTP, and the API key is never accepted as a command argument.

Kernel commands use the authenticated Runtime control protocol. `ensure` may return an installed kernel immediately or a download task id that can be queried with `kernel download status`.
