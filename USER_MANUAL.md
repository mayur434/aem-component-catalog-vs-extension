# AEM Component Catalog Enterprise — User Manual

## 1. Scope

This extension supports both Adobe Experience Manager as a Cloud Service (AEMaaCS) and Adobe Experience Manager as a Managed Service (AMS). A reactor is recognized as AEMaaCS when it declares `core`, `ui.apps`, `ui.config`, `all`, plus Cloud SDK or Cloud Analyser markers; as AMS when it has an `uber-jar`/`cq-quickstart` dependency with a Java module (`core` or `bundle`) and a content module (`ui.apps` or `content`). Component discovery, Sling Model detection, usage scanning, and local deploy target the same conventions on both platforms. **AEM Cloud Doctor is AEMaaCS-specific** — it enforces the canonical Adobe archetype module layout and will report false positives if run against an AMS reactor.

## 2. Installation from source

```bash
npm ci
npm run quality
npm run compile
npm run package:vsix
code --install-extension aem-component-library-generator-2.1.0.vsix
```

Reload VS Code after installation.

## 3. First-time workflow

1. Open the AEMaaCS or AEM AMS reactor (or a workspace containing one or more reactors).
2. Trust the workspace. Read-only discovery remains available in Restricted Mode, but writes are blocked.
3. Open the **Catalog panel** — click the "AEM CL" status bar item, the book icon on the Projects sidebar view, or right-click a project and choose **Open Catalog Panel**.
4. On the **Configure** tab, review the defaults (brand, theme, features, site domains) and click **Generate Micro-site**. This writes `.component-library.json` on first run.
5. Click **Deploy to Local AEM** from the same tab, then verify the catalog on the local AEM Author service.
6. Use the **Audit** tab for a portfolio-wide tech audit (classification, duplicates, usage, Excel export) across AEMaaCS and AMS projects.
7. (AEMaaCS only, optional) Run **AEM Cloud Doctor** from a project's context menu for a governance/compliance health check — this never blocks generation.

## 4. Commands

| Command                                   | Purpose                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Open Catalog Panel                        | Unified panel — Overview (portfolio health), Configure & Generate, and Audit tabs    |
| Configure & Generate Micro-site           | Open the Catalog panel's Configure tab, review defaults, and generate                |
| Generate (Use Existing Config)            | Re-generate using the existing configuration, no prompts                             |
| Deploy to Local AEM                       | Build and deploy `core`/`bundle`, `ui.apps`, `ui.config` to a local instance          |
| Preview Generation Plan                   | Show desired artifacts, state, conflicts, orphans, and text diffs                    |
| Scan Components                           | Produce the detailed local governance report                                         |
| Run Component Audit                       | Classification, duplicate detection, usage analysis, Excel export (AEMaaCS & AMS)    |
| (Advanced) Run AEM Cloud Doctor           | Validate AEMaaCS structure, packages, configuration, governance, RepoInit, and drift |
| Roll Back Last Generation                 | Restore the latest transaction snapshot                                              |
| (Advanced) Export Redacted Support Bundle | Export local diagnostics without absolute project paths                              |

The headless CLI additionally exposes `init`, `preflight`, `remediate`, and `unlock` (see §4a and §10) — these are not currently surfaced as VS Code commands.

### 4.1 Configure & Generate

The **Configure & Generate** tab is a single-page form for producing the catalog
from scratch or adjusting an existing one: brand name, catalog title (with presets),
description, theme colors (swatch presets, a custom picker, or auto-detected from the
workspace's clientlib CSS), the sub-category fallback property, per-site domains, and
feature toggles. Clicking **Generate Micro-site** writes the configuration and runs
generation directly — no preflight or Cloud Doctor gate blocks it. Headless generation
(the CLI's `generate` command) runs the fuller safety pipeline described in §4a.

## 4a. Advanced failure handling

Generation is guarded on three levels so failures surface before, not after, a write:

- **Preflight** — fast, side-effect-free readiness checks (workspace trust, required
  modules, valid configuration, discoverable components, writable targets, a free
  generation lock, and a buildable plan). Each failure names a one-click remediation
  where one exists. Run headlessly with `aem-catalog preflight` (exit `1` when blocked).
- **Detect-and-guide remediation** — known findings map to concrete, reviewable fixes:
  create the configuration/policy, seed missing governance metadata (XML-escaped, only
  the missing properties), and scaffold component READMEs. Preview with
  `aem-catalog remediate <id>`; apply with `--yes`. Every applied fix is backed up under
  `.aem-catalog/remediation-backups/` and recorded in the audit log.
- **Generation lock** — a project cannot be generated by two processes at once; a lock
  left by a crashed run is detected as stale and reclaimed (`aem-catalog unlock` clears one).

## 5. Configuration

The configuration has `schemaVersion: 2`. Unversioned v1 configuration is migrated in memory when loaded; save the file to persist v2.

Main sections:

- `brand`: validated colors and local font stack
- `components`: JCR root, excluded groups, thumbnails, and layouts
- `features`: catalog search, filters, lightbox, snippets, documentation, quality, dependencies, and accessibility
- `output`: Java package, clientlib category, content path, title, and resource type
- `serviceUser`: author-only service user and subservice mapping
- `hero`: escaped catalog copy and statistics
- `catalog`: author deployment, cache duration, and API page size
- `governance`: policy location and metadata property names
- `taxonomy`: two-level catalog grouping — **Category** = the website (first path segment under the components root, displayed via `categoryLabels`); **Sub Category** = the `subCategoryProperty` value on the component when present, otherwise its AEM `componentGroup`

Unsafe path traversal, invalid Java/resource names, dangerous CSS characters, publish deployment, and unsupported cache/page sizes are rejected before planning.

## 6. Component quality

The default score is explainable and deterministic:

| Capability       | Weight |
| ---------------- | -----: |
| Author dialog    |     25 |
| README           |     20 |
| Thumbnail        |     15 |
| Owner            |     15 |
| Lifecycle status |     15 |
| Version          |     10 |

Cloud Doctor can enforce a minimum score. It also inventories dialog fields, design dialogs, supertype dependencies, Sling Models, JSON exporters, and local content usages.

## 7. Cloud Doctor

Doctor validates:

- positive AEMaaCS identification
- required Maven modules and Cloud Dispatcher (`dispatcher` or `dispatcher.cloud`)
- FileVault mutable/immutable package separation
- `all` container embeds
- RepoInit JSON shape and author run-mode placement
- configuration and organization policy
- component documentation and governance metadata
- generated file conflicts, stale output, and orphaned manifest entries

Severity is controlled by `.aem-catalog-policy.json`. `off` disables a rule. SARIF output can be uploaded by CI code-scanning systems.

## 8. Generation and rollback

Generated files are tracked by relative path and SHA-256-derived content hash. Manual changes are never silently replaced. Move long-lived customization into configuration, metadata, templates maintained in this extension, or a deliberate downstream overlay.

Before changing files, the engine stores a transaction under `.aem-catalog/backups/<transaction-id>`. The folder and audit log are local and ignored by Git. Rollback restores prior contents and the prior ownership manifest.

## 9. Runtime security

- Catalog provisioning occurs under `config.author`.
- The servlet independently checks the AEM `author` run mode.
- The service user receives read permission only for the configured application components and clientlibs through RepoInit restrictions.
- Runtime responses use private caching and `nosniff`.
- Metadata is cached and invalidated by Sling resource changes.
- README text is escaped before the limited Markdown renderer creates HTML.
- The Catalog panel webview inlines all CSS and JS (no external resource loading), enforces a strict CSP, allow-lists message shapes, and uses discovered-project identifiers rather than raw paths in messages.

## 10. CI usage

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

CI should fail when `preflight` or `doctor` returns exit code `1`. `generate` runs the
preflight and Doctor gates itself and aborts unless they pass or `--force` is given.
Generation in CI requires `--yes`; conflicts still require deliberate `--force`.

## 11. Troubleshooting

### No AEM project found

For AEMaaCS: confirm the reactor POM uses `packaging=pom`, declares modules, and contains `aem-sdk-api`, the AEM analyser, or the standard Cloud module/Dispatcher structure. For AMS: confirm the POM declares an `uber-jar`/`cq-quickstart-product-dependencies` dependency (or references `com.adobe.aem`) alongside a Java module (`core` or `bundle`) and a content module (`ui.apps` or `content`).

### Doctor reports package separation errors

Keep immutable code below `/apps` in `ui.apps`; put OSGi configuration in `ui.config`; put mutable content in `ui.content` or provision supported baseline structures through RepoInit.

### Generation reports a conflict

Open Preview and review the diff. Preserve the file and migrate customization into configuration, or use the CLI `--force` only when replacement is intended.

### Catalog endpoint returns 404

The endpoint is author-only. Verify the request is on Author and that the catalog page exists after the author RepoInit configuration runs.

### Need support information

Run **Export Redacted Support Bundle**. Inspect the JSON before sharing it with your support team.
