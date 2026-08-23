---
sidebar_position: 1
---

# Introduction

## Why this exists

Many organizations run several independent AEM reactors — separate brand or business-unit sites, on AEM as a Cloud Service (AEMaaCS) or AEM as a Managed Service (AMS) — each with its own component library. Left alone, that produces the usual multi-brand problem: nobody outside the immediate development team can see what components exist, which ones are documented, which are duplicated across brands, or which quietly fall short of the org's authoring and governance standards.

**AEM Component Catalog** (npm package `aem-component-library-generator`, VS Code extension id `aem-catalog.aem-component-library-generator`) is the tool built to close that gap. It turns a brand's raw component source tree into a governed, browsable catalog micro-site — deployed straight into the same reactor — and it does that through the same deterministic engine whether it's triggered from the VS Code UI, a terminal, or a CI pipeline, whether that reactor is AEMaaCS or AMS.

## Business benefits

These are the outcomes the tool is designed to produce. They aren't collected via telemetry (the extension intentionally emits none — see [Runtime security](./usage-manual/generation-safety-and-ci#runtime-security)); they're measured from the reports the tool itself produces (Cloud Doctor findings, Scan/quality reports, and Audit output), so a team can track them the same way in every reactor.

- **Governance visibility across brands.** A single, explainable quality score (dialog, README, thumbnail, owner, lifecycle status, version) applies uniformly to every component in every reactor, so "is this component production-ready and documented?" has the same, checkable answer everywhere.
- **Lower risk of losing manual work.** Generation is atomic and ownership-tracked: existing files without a matching ownership hash are treated as conflicts and preserved, not overwritten. A failed run rolls back everything it touched, and **Roll Back Last Generation** restores the last successful transaction on demand.
- **Compliance that CI can enforce, not just recommend.** AEM Cloud Doctor evaluates a component/organization policy (`.aem-catalog-policy.json`) and can emit SARIF, so governance regressions show up as pull-request code-scanning findings instead of being discovered after release.
- **Faster, safer onboarding for new engineers.** The guided **Create Micro-site** wizard plus a three-layer failure-handling model (preflight → detect-and-guide remediation → generation lock) means a new team member reaches a first successful, compliant catalog generation without having to learn the configuration schema by hand.
- **Cross-brand duplicate detection.** The companion Tech Audit Report (Excel output) scans component source across reactors — AEMaaCS and AMS alike — to surface duplicated components, a governance question the per-reactor catalog view alone can't answer.
- **Reduced security/privacy review burden.** No telemetry, redacted support bundles, an author-only runtime service user, and a strict webview CSP mean the tool is straightforward to clear for use inside a regulated enterprise environment.

Teams adopting this tool can track their own rollout using exactly these dimensions: percentage of components meeting the minimum quality score, percentage with a README/thumbnail/owner/lifecycle status set, the count and severity of open Cloud Doctor findings, and the number of cross-brand duplicates the Audit report surfaces — before and after rollout, per reactor.

## What it is, concretely

- A **VS Code extension** (`AEM Component Catalog` in the Activity Bar) for interactive, guided use during development.
- A **headless CLI** (`aem-catalog`, `out/cli.js`) that shares the exact same validation, policy, planning, and transaction engine — so a local run and a CI run produce the same result.
- Support for **both AEMaaCS and AEM AMS** reactors for catalog generation — component discovery, quality scoring, preflight, remediation, and generation itself all work identically on either platform, including AMS reactors that use the alternate `bundle`/`content` module naming instead of `core`/`ui.apps`. AEM 6.5 without either a Cloud SDK dependency or an AMS-recognizable module/dependency shape, and other on-premise setups, remain unsupported. Cloud Doctor is the one AEMaaCS-specific check (see [Getting Started](./usage-manual/getting-started)).

## Who it's for

- **Developers and tech leads** on any brand reactor, who run the guided flow or the CLI to stand up or update that reactor's catalog.
- **Platform/governance owners**, who define the organization policy preset, review Cloud Doctor SARIF findings in pull requests, and track quality-score and documentation-coverage trends across brands.
- **CI pipelines**, which gate merges on `aem-catalog preflight` and `aem-catalog doctor` exit codes.

Continue to [Features & Capabilities](./features) for what the tool does, or jump straight to the [Usage Manual](./usage-manual/getting-started) if you're setting it up.
