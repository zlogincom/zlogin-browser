# @zlogin/cli

Windows-first ZLogin Runtime CLI skeleton on the `cli` branch. Commands expose stable JSON/human output while Runtime and Open API integration is added incrementally.

```text
zlogin version
zlogin doctor [--json]
zlogin runtime status [--json]
zlogin runtime update [--json]
zlogin auth status [--json]
```

Exit codes: `0` success, `1` invalid/unknown command, `2` unavailable or unconfigured Runtime.
