# Security Policy

## Supported versions

Security fixes are provided for the latest `2.x` release. The legacy `1.x` line is unsupported.

## Reporting

Do not open a public issue for a suspected vulnerability. Report it privately through the repository security advisory feature and include:

- affected extension version
- minimal reproduction
- impact and required user interaction
- whether the issue affects the VS Code extension, generated AEM code, or CLI

Do not include production credentials, customer content, or unredacted support bundles.

## Security boundaries

- Workspace writes require VS Code Workspace Trust.
- Webview messages identify only already-discovered projects.
- Generated paths are contained within the selected reactor.
- AEM runtime output is author-only and uses a least-privilege service user.
- The extension stores no Adobe, AEM, Cloud Manager, or RDE credentials.
- Telemetry is not collected.

Dependencies are audited in CI and release artifacts include an SBOM and provenance attestation.
