---
sidebar_position: 4
---

# Generation Safety, Runtime Security & CI

## Safe generation model

The engine renders the complete desired artifact set before writing anything. Every output is classified as `create`, `update`, `unchanged`, or `conflict`.

- Existing files without a matching ownership hash are treated as conflicts.
- Safe generation preserves conflicts — it does not overwrite them.
- Writes go through a temporary sibling file and an atomic rename.
- Existing contents and the ownership manifest are backed up before any change.
- Any failure rolls back the files already written in that transaction.
- `.aem-catalog/audit.jsonl` records hashes and outcomes for every run, without file content.
- **Roll Back Last Generation** restores the latest successful transaction.

The local `.aem-catalog/` state directory is Git-ignored. The portable ownership file `.aem-catalog-manifest.json` should be committed, so every developer and CI agent shares the same drift detection.

## Generated AEMaaCS artifacts

- A resource-type servlet under `core`
- A page rendering component and client library under `ui.apps`
- Service-user mapping and RepoInit under `ui.config/.../config.author`
- The author content page and baseline template, created by RepoInit

The runtime servlet independently checks the `author` run mode and returns `404` elsewhere. No Cloud Manager, RDE, AEM, or Adobe credentials are stored by the extension at any point.

## Runtime security

- Catalog provisioning occurs entirely under `config.author`.
- The generated servlet independently checks the AEM `author` run mode.
- The service user receives **read-only** permission, scoped to the configured application components and clientlibs, via RepoInit restrictions.
- Runtime responses use private caching and the `nosniff` header.
- Metadata is cached and invalidated by Sling resource changes.
- README text is escaped before the limited Markdown renderer turns it into catalog HTML.
- The VS Code dashboard webview uses external assets, a strict CSP, allow-listed messages, and discovered-project identifiers rather than filesystem paths.

## Enterprise rollout

The recommended sequence for onboarding a new brand reactor (or the organization as a whole):

1. Run Doctor in report-only mode and inventory existing gaps.
2. Assign owners and lifecycle states to components.
3. Establish an organization policy with warnings (not errors) initially.
4. Remediate package-boundary and security errors first.
5. Raise selected governance rules from warning to error once the backlog is clear.
6. Add the CLI to pull-request CI and upload SARIF output.
7. Commit configuration, policy, and the ownership manifest.

### Pull-request gate

Run `npm ci`, the extension's own quality checks, `aem-catalog doctor`, the AEM Maven build, and the same Cloud Manager–compatible checks the organization already uses. This tool **complements** Cloud Manager's quality, security, functional, and experience gates — it doesn't replace them.

### Release management

- Template changes require fixture coverage and a SemVer release.
- Configuration schema changes require a migration before the schema version itself changes.
- Release tags build a VSIX, an SBOM, SHA-256 checksums, and GitHub provenance.
- Marketplace publication is a separate, explicitly approved step — the release workflow creates signed artifacts without publishing them automatically.

### Recovery

Use rollback immediately after a failed functional validation. Rollback snapshots are local — they are not source control or a long-term backup. Git remains the system of record.

### Privacy

No telemetry is emitted. Diagnostic bundles are local JSON and redact absolute project roots and secret-like fields. Operators should still inspect a bundle before sharing it outside the organization.

## CI usage

```bash
aem-catalog init --project . --yes
aem-catalog preflight --project . --format json --output preflight.json
aem-catalog doctor --project . --format sarif --output aem-cloud-doctor.sarif
aem-catalog scan --project . --format csv --output component-inventory.csv
aem-catalog plan --project . --format json --output generation-plan.json
aem-catalog remediate scaffold-governance-metadata --project .            # dry run (exit 1 if changes pending)
aem-catalog remediate scaffold-governance-metadata --project . --yes      # apply
aem-catalog generate --project . --yes                                    # preflight + doctor gated
```

CI should fail the build whenever `preflight` or `doctor` returns exit code `1`. `generate` runs the preflight and Doctor gates itself and aborts unless they pass — or `--force` is explicitly given. Generation in CI requires `--yes`; conflicts still require deliberate `--force`.

## Development workflow

```bash
npm ci
npm run quality           # check + lint + test
npm run test:coverage
npm run test:integration
npm run compile
npm run package:vsix
```

Next: [Troubleshooting](./troubleshooting).
