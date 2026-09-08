# @zlogin/cli

Windows-first ZLogin Runtime CLI on the `cli` branch. Commands expose stable JSON/human output while Runtime and Open API integration is added incrementally.

```text
zlogin version
zlogin doctor [--json]
zlogin runtime status [--json]
zlogin runtime update [--json]
zlogin auth status [--json]
```

`runtime update` reads `ZLOGIN_RUNTIME_RELEASES_URL` and optional `ZLOGIN_RUNTIME_CHANNEL`, verifies the HTTPS release manifest, downloads the artifact, checks its size, SHA-256 and Ed25519 signature, extracts it through a path-checked `tar` archive, and atomically updates the current pointer. The trusted public key is supplied through `ZLOGIN_RUNTIME_PUBLIC_KEY`; `ZLOGIN_RUNTIME_PUBLIC_KEY_ID` can pin the manifest key id.

Exit codes: `0` success, `1` invalid/unknown command, `2` unavailable, unconfigured, or failed Runtime installation.
