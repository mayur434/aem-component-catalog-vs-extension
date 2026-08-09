# Enterprise Operations

## Recommended rollout

1. Run Doctor in report-only mode and inventory existing gaps.
2. Assign owners and lifecycle states.
3. Establish an organization policy with warnings.
4. Remediate package-boundary and security errors.
5. Raise selected governance rules to errors.
6. Add the CLI to pull-request CI and upload SARIF.
7. Commit configuration, policy, and the ownership manifest.

## Pull-request gate

Run `npm ci`, extension quality checks, `aem-catalog doctor`, the AEM Maven build, and the same Cloud Manager-compatible checks used by the organization. The extension complements rather than replaces Cloud Manager quality, security, functional, and experience gates.

## Release management

- Template changes require fixture coverage and a SemVer release.
- Config schema changes require a migration before the schema version changes.
- Release tags build a VSIX, an SBOM, SHA-256 checksums, and GitHub provenance.
- Marketplace publication is a separately approved step; the release workflow intentionally creates signed artifacts without publishing them automatically.

## Recovery

Use rollback immediately after a failed functional validation. Rollback snapshots are local; do not use them as source control or long-term backups. Git remains the system of record.

## Privacy

No telemetry is emitted. Diagnostic bundles are local JSON and redact absolute project roots and secret-like fields. Operators must still inspect bundles before transferring them outside the organization.
