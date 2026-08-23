---
sidebar_position: 2
---

# Features & Capabilities

Every capability below ships in both the VS Code extension and the headless CLI, backed by the same core engine (see [Architecture](./architecture)).

## Discovery & inventory

- **AEMaaCS and AEM AMS project detection and package-boundary validation.** The tool activates against a positively-identified AEM reactor — either AEMaaCS (Cloud SDK/analyser markers, or the standard Cloud module and Dispatcher structure) or AEM AMS (an `uber-jar`/`cq-quickstart` dependency plus a Java module and a content module) — with the required `core` (or `bundle`), `ui.apps` (or `content`), `ui.config`, and `all` modules.
- **Recursive component inventory.** Scans component source for dialog fields, Sling Models, JSON exporters, page usages, dependencies, owners, versions, tags, and lifecycle status.
- **Explainable component quality score.** A deterministic, weighted score (see [Component quality](./usage-manual/configuration-and-governance#component-quality)) rather than an opaque heuristic — every point is traceable to a specific, missing or present capability.

## Governance & policy

- **Governance metadata model.** Components declare `catalogOwner`, `catalogStatus`, `catalogVersion`, and `catalogTags` directly on their `.content.xml` (property names are configurable); lifecycle statuses default to `draft`, `active`, `deprecated`.
- **Organization policy presets.** `.aem-catalog-policy.json` extends a preset (`recommended-aemaacs` or `strict-aemaacs`), sets per-rule severity (`error` / `warning` / `info` / `off`), and can enforce a minimum quality score. See the full [Policy Reference](./usage-manual/configuration-and-governance#policy-reference).
- **AEM Cloud Doctor.** Validates AEMaaCS project structure, required modules and Dispatcher, FileVault immutable/mutable package separation, `all` container embeds, RepoInit shape and author run-mode placement, configuration and policy validity, component documentation/governance completeness, and generated-file drift (conflicts, stale output, orphaned manifest entries) — with **Markdown, JSON, and SARIF** report output for CI code-scanning. Doctor's structural checks (package separation, `all` embeds) are AEMaaCS-specific by design; running it against an AEM AMS reactor is not recommended (see [Getting Started](./usage-manual/getting-started)).

## Safe generation

- **Plan before write.** The engine renders the complete desired artifact set first and classifies every output as `create`, `update`, `unchanged`, or `conflict` before anything is touched.
- **Manual-change preservation.** Existing files without a matching ownership hash are treated as conflicts and left alone rather than silently overwritten.
- **Atomic, recoverable writes.** Writes go through a temporary sibling file and atomic rename; existing content and the ownership manifest are backed up first; any failure rolls back everything already written; **Roll Back Last Generation** restores the latest successful transaction from `.aem-catalog/backups/<transaction-id>`.
- **Local audit trail.** `.aem-catalog/audit.jsonl` records generation hashes and outcomes (not file content) for every run.

## Guided authoring & failure handling

- **Create Micro-site wizard.** A single guided flow (brand colors, page title, hero copy, sub-category taxonomy property, author deploy target) that writes configuration and then runs the same safety pipeline as headless generation: **preflight → detect-and-guide remediation → Cloud Doctor → transactional generation**, with every remediation and the final apply previewed and requiring explicit approval.
- **Preflight checks.** Fast, side-effect-free readiness checks — workspace trust, required modules, valid configuration, discoverable components, writable targets, a free generation lock, a buildable plan — each with a one-click remediation where one exists. Scriptable via `aem-catalog preflight` (exit code `1` when blocked).
- **Detect-and-guide remediation.** Known findings map to concrete, reviewable, backed-up fixes: create configuration/policy, seed missing (XML-escaped) governance metadata, scaffold component README stubs. Preview with `aem-catalog remediate <id>`, apply with `--yes`.
- **Generation lock.** Prevents two concurrent generations of the same project; a lock left by a crashed run is detected as stale and reclaimed, or cleared explicitly with `aem-catalog unlock`.

## Reporting

- **JSON, CSV, Markdown, and SARIF** report formats across scan, doctor, and plan commands.
- **Redacted diagnostic support bundles** — project-root paths and secret-like configuration keys are stripped before export.
- **Checksummed template registry** — makes drift in the generated-artifact template set visible.

## Cross-brand technical audit

- **Tech Audit Report** (`AEM Component Audit: Generate Tech Audit Report`) — a separate, read-only reporting engine (`src/audit`) that classifies components, parses content packages, and detects **duplicate components across reactors**, exporting an Excel report. This command's scope explicitly includes **both AEMaaCS and AEM AMS** projects, since it's answering a cross-portfolio governance question rather than generating a live catalog.

## Security & privacy by design

- **No telemetry.**
- **Author-only catalog provisioning**, via `ui.config/config.author` and a service user scoped to read-only access on the configured application components and clientlibs through RepoInit restrictions.
- **Runtime self-enforcement** — the generated servlet independently checks the AEM `author` run mode and returns `404` elsewhere, so the catalog can't leak onto Publish even if content is copied there by accident.
- **Hardened VS Code webview** — strict CSP, allow-listed messages, path containment (the webview never supplies a filesystem path to a privileged handler), and Workspace Trust support (generation is disabled entirely in an untrusted workspace).
- **Sanitized README rendering** — README content is escaped before a limited Markdown renderer turns it into HTML for the catalog page.
- **Cached, invalidated runtime metadata** — the catalog servlet caches metadata and invalidates on Sling resource changes, with private caching and `nosniff` response headers.

## Delivery & supply chain

- **Cross-platform CI**, dependency review, SBOM generation (`npm run sbom`), VSIX packaging, and GitHub release provenance for every tagged release.

Next: [Supporting Stack & Architecture](./architecture).
