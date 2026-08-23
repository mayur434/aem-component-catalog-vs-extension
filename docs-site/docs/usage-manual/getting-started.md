---
sidebar_position: 1
---

# Getting Started

## Requirements

- VS Code 1.100+
- Node.js 20+ (for source development or standalone CLI use)
- An AEM Maven reactor recognized as either:
  - **AEMaaCS** — based on the current AEM Project Archetype, with Cloud SDK/analyser markers or the standard Cloud module and Dispatcher structure, containing `core`, `ui.apps`, `ui.config`, and `all`. The current archetype `dispatcher` module name is expected (the legacy `dispatcher.cloud` name is also supported).
  - **AEM AMS** (Adobe Managed Services) — an `uber-jar`/`cq-quickstart-product-dependencies` dependency (or a `com.adobe.aem` reference), with a Java module (`core` or `bundle`) and a content module (`ui.apps` or `content`).
- **`ui.config` is mandatory on both platforms** — it hosts the generated service-user mapping and RepoInit configuration the catalog depends on. A project missing it is rejected up front (see [Prerequisite validation](#prerequisite-validation) below), before any configuration is created or written.

Plain AEM 6.5 without either of the above markers, and other on-premise setups, are not supported. AEM Cloud Doctor is the one **AEMaaCS-specific** feature — see the note at the end of this page.

## Installing from source

```bash
npm ci
npm run quality
npm run compile
npm run package:vsix
code --install-extension aem-component-library-generator-2.1.0.vsix
```

Reload VS Code after installation.

## Prerequisite validation

Before **Configure & Generate Micro-site**, **Generate (Use Existing Config)**, or `aem-catalog init`/`generate` do anything else — even before `.component-library.json` is created — the tool runs a fast, structural check: is this an AEMaaCS or AEM AMS reactor, and is `ui.config` present? If either check fails, the VS Code commands stop with a clear modal explaining exactly what's missing (no reactor detected, or `ui.config` missing) instead of failing deep inside generation or leaving a partially-initialized project. The CLI equivalents exit non-zero with the same message. This check is deliberately independent of configuration — it runs even on a project that has never been configured.

## First-time workflow

1. **Open the AEM project** (the reactor root, or a workspace containing one or more reactors) — AEMaaCS or AEM AMS.
2. **Trust the workspace.** Read-only discovery still works in Restricted Mode, but writes are blocked until the workspace is trusted.
3. Run **Init** to create `.component-library.json` (schema v2) and `.aem-catalog-policy.json` — or just run **Configure & Generate Micro-site**, which writes sensible defaults on first run with nothing to hand-edit first.
4. (AEMaaCS only) Run **AEM Cloud Doctor** and resolve all reported errors. Doctor's structural checks (package separation, `all` embeds) assume the AEMaaCS archetype layout and are not recommended against an AMS reactor — module presence, RepoInit shape, configuration, and governance/documentation checks still apply to AMS, but skip Doctor's package-boundary checks there.
5. Run **Scan Components** to review component metadata and quality.
6. Run **Preview** to inspect every file's planned state and diff before anything is written.
7. Run **Generate** and confirm the modal transaction prompt.
8. Build the Maven reactor and verify the catalog on the local AEM SDK Author service.

## The guided path: Create Micro-site

For a first-time setup, **AEM Component Catalog: Configure & Generate Micro-site** collapses steps 3–7 above into one wizard. It walks through brand colors, page title, hero copy, the sub-category taxonomy property, and the author deploy target — each field validated live, with Back/Next/Cancel — then runs the full safety pipeline: **prerequisite validation → preflight → detect-and-guide remediation → Cloud Doctor → transactional generation**. Every remediation and the final apply step is previewed and requires explicit approval; nothing is written silently.

You can also reach it from the **Catalog panel**'s Configure tab (open it via the "AEM CL" status bar item, the Projects sidebar's book icon, or a project's context menu), or run **Deploy to Local AEM (core/bundle, ui.apps, ui.config)** from the same panel once generation succeeds.

:::note Generation is disabled in an untrusted workspace
The extension never silently overwrites manually changed files, in a trusted workspace or otherwise.
:::

Next: the full [Commands Reference](./commands-reference).
