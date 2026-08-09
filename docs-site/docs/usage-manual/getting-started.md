---
sidebar_position: 1
---

# Getting Started

## Requirements

- VS Code 1.100+
- Node.js 20+ (for source development or standalone CLI use)
- An AEMaaCS Maven reactor based on the current AEM Project Archetype, containing the required modules: `core`, `ui.apps`, `ui.config`, and `all`
- The current archetype `dispatcher` module (the legacy `dispatcher.cloud` name is also supported)

AEM 6.5, Adobe Managed Services, and on-premise projects are **intentionally unsupported** for catalog generation. (The separate Tech Audit Report is the exception — see [Features](../features#cross-brand-technical-audit).)

## Installing from source

```bash
npm ci
npm run quality
npm run compile
npm run package:vsix
code --install-extension aem-component-library-generator-2.0.0.vsix
```

Reload VS Code after installation.

## First-time workflow

1. **Open the AEMaaCS project** (the reactor root, or a workspace containing one or more reactors).
2. **Trust the workspace.** Read-only discovery still works in Restricted Mode, but writes are blocked until the workspace is trusted.
3. Run **Init** to create `.component-library.json` (schema v2) and `.aem-catalog-policy.json` — or just run **Configure & Generate Micro-site**, which writes sensible defaults on first run with nothing to hand-edit first.
4. Run **AEM Cloud Doctor** and resolve all reported errors.
5. Run **Scan Components** to review component metadata and quality.
6. Run **Preview** to inspect every file's planned state and diff before anything is written.
7. Run **Generate** and confirm the modal transaction prompt.
8. Build the Maven reactor and verify the catalog on the local AEM SDK Author service.

## The guided path: Create Micro-site

For a first-time setup, **AEM Component Catalog: Configure & Generate Micro-site** collapses steps 3–7 above into one wizard. It walks through brand colors, page title, hero copy, the sub-category taxonomy property, and the author deploy target — each field validated live, with Back/Next/Cancel — then runs the full safety pipeline: **preflight → detect-and-guide remediation → Cloud Doctor → transactional generation**. Every remediation and the final apply step is previewed and requires explicit approval; nothing is written silently.

You can also reach it from the status bar dashboard, or run **Deploy to Local AEM (core, ui.apps, ui.config)** from the same panel once generation succeeds.

:::note Generation is disabled in an untrusted workspace
The extension never silently overwrites manually changed files, in a trusted workspace or otherwise.
:::

Next: the full [Commands Reference](./commands-reference).
