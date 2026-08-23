---
sidebar_position: 2
---

# Commands Reference

## VS Code commands

All commands live under the **AEM Component Catalog** activity, prefixed `AEM Component Catalog:` (the audit command is prefixed `AEM Component Audit:`). Most require at least one open workspace folder.

| Command | Purpose |
| --- | --- |
| **Open Catalog Panel** | The unified, tabbed **Catalog panel** — Overview (portfolio health), Configure & Generate, and Audit tabs, preserving each tab's state when you switch between them. |
| **Configure & Generate Micro-site** | Opens the Catalog panel's Configure tab: collect inputs → prerequisite validation → preflight → guided fixes → generate. The recommended entry point for a first-time setup. |
| **Deploy to Local AEM (core/bundle, ui.apps, ui.config)** | Deploys the generated modules to a local AEM SDK Author instance. Deliberately limited to the Java module (`core` or `bundle`), `ui.apps`/`content`, and `ui.config` — it never deploys `ui.content`, so a local deploy can't clobber authored content or configuration living in that module. |
| **Generate (Use Existing Config)** | Applies safe changes in an atomic transaction using the already-saved configuration, with no prompts. |
| **Preview Generation Plan** | Shows desired artifacts, per-file state (`create` / `update` / `unchanged` / `conflict`), orphans, and text diffs — without writing anything. |
| **Scan Components** | Produces the detailed local governance/quality report for every discovered component. |
| **Refresh Sidebar** | Refreshes the Projects / Components tree views. |
| **(Advanced) Run AEM Cloud Doctor** | Validates AEMaaCS structure, packages, configuration, governance, RepoInit, and drift. AEMaaCS-specific by design — see [Getting Started](./getting-started). |
| **Roll Back Last Generation** | Restores the latest successful transaction snapshot. |
| **(Advanced) Export Redacted Support Bundle** | Exports local diagnostics with absolute project paths and secret-like fields redacted. |
| **AEM Component Audit: Generate Tech Audit Report (AEMaaCS & AMS)** | Produces the cross-project Excel audit — component classification, content-package parsing, and duplicate-component detection across both AEMaaCS and AEM AMS reactors. |

The Activity Bar container also exposes two tree views — **Projects** and **Components** — for navigating without the command palette; actions themselves live in the Catalog panel and in a project's right-click context menu.

## Headless CLI (`aem-catalog`)

The CLI is built to `out/cli.js` and exposed as the `aem-catalog` binary; it shares the same engine as the VS Code commands above, so a local CLI run and a CI run produce identical results.

```bash
npm ci
npm run compile

node out/cli.js init --project /path/to/aem-project --yes
node out/cli.js preflight --project /path/to/aem-project
node out/cli.js doctor --project /path/to/aem-project
node out/cli.js doctor --project /path/to/aem-project --format sarif --output doctor.sarif
node out/cli.js scan --project /path/to/aem-project --format csv --output components.csv
node out/cli.js plan --project /path/to/aem-project
node out/cli.js remediate <finding-id> --project /path/to/aem-project        # preview
node out/cli.js remediate <finding-id> --project /path/to/aem-project --yes  # apply
node out/cli.js generate --project /path/to/aem-project --yes
node out/cli.js rollback --project /path/to/aem-project --yes
node out/cli.js unlock --project /path/to/aem-project
node out/cli.js support --project /path/to/aem-project --output support.json
```

`generate` refuses to run when Cloud Doctor reports errors, by default. `--force` is explicit, and is also required to permit overwriting conflicts — use it only after reviewing the plan with `preview`/`plan`.

## Advanced failure handling

Generation is guarded on four levels, so failures surface **before**, not after, a write:

0. **Prerequisite validation** — a structural, configuration-independent gate that runs before anything else, even before `.component-library.json` exists: is this a recognized AEMaaCS or AEM AMS reactor, and is `ui.config` present? Blocks with a clear message (VS Code: a modal; CLI: non-zero exit) rather than failing deep inside generation.
1. **Preflight** — fast, side-effect-free readiness checks: workspace trust, required modules, valid configuration, discoverable components, writable targets, a free generation lock, and a buildable plan. Each failure names a one-click remediation where one exists. Run headlessly with `aem-catalog preflight` (exit code `1` when blocked).
2. **Detect-and-guide remediation** — known findings map to concrete, reviewable fixes: create the configuration/policy, seed missing governance metadata (XML-escaped, only the missing properties), and scaffold component README stubs. Preview with `aem-catalog remediate <id>`; apply with `--yes`. Every applied fix is backed up under `.aem-catalog/remediation-backups/` and recorded in the audit log.
3. **Generation lock** — a project cannot be generated by two processes at once; a lock left behind by a crashed run is detected as stale and reclaimed automatically, or cleared explicitly with `aem-catalog unlock`.

Next: [Configuration & Governance](./configuration-and-governance).
