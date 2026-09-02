# Public Release Checklist

Complete these items before changing the repository visibility to public or publishing packages from it.

## Legal and Ownership

- [ ] Confirm which code, schemas, documentation, and assets ZLogin owns and may redistribute.
- [ ] Choose an open-source or commercial license and add `LICENSE`.
- [ ] Set matching `license` metadata in every package that will be published.
- [ ] Add repository, contribution, and support information.

## Security

- [ ] Confirm no API keys, customer data, cookies, account secrets, proxy passwords, or private binaries are tracked.
- [ ] Restrict configurable API destinations so credentials cannot be sent to an unintended host.
- [ ] Document least-privilege API key setup and local-only deployment boundaries.
- [ ] Enable GitHub private vulnerability reporting or publish a security contact.
- [ ] Review CLI and MCP destructive operations and their confirmation behavior.

## Quality and Release

- [ ] Add unit, contract, and real-client smoke tests for supported workflows.
- [ ] Add API contract synchronization checks to CI.
- [ ] Pin GitHub Action versions for release workflows.
- [ ] Run dependency audit and license checks.
- [ ] Verify npm package contents with a dry run before publishing.
- [ ] Decide whether the Skill should live here or in a smaller standalone public repository.
