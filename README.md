# AEM Component Library Generator

Auto-generates a fully functional, brand-aligned **Component Library** site for Adobe Experience Manager projects.

## What It Does

From a single `.component-library.json` config, the extension generates:

- **Sling Servlet** — discovers all components at runtime (groups, dialogs, thumbnails, layouts)
- **Page Component** — branded HTML with search, group filters, lightbox, and code snippets
- **Client Library** — CSS (brand tokens) + JS (dynamic fetch, filters, lightbox)
- **OSGi Configs** — service user mapper + repoinit for JCR read access
- **Content Page** — ready-to-deploy `cq:Page` under `/content/<appId>/component-library`

## Quick Start

1. Open your AEM project in VS Code
2. `Cmd+Shift+P` → **AEM Component Library: Init** — creates `.component-library.json`
3. Customise brand colours, features, hero text in the JSON file
4. `Cmd+Shift+P` → **AEM Component Library: Generate** — writes all files
5. Build & deploy: `mvn clean install -PautoInstallSinglePackage -DskipTests`
6. Open: `http://localhost:4502/content/<appId>/component-library.html`

## Commands

| Command | Description |
|---------|-------------|
| **Init** | Detect project, prompt for brand settings, create config |
| **Generate** | Full generation of servlet, page component, clientlib, configs, content |
| **Update** | Re-generate only files that haven't been manually modified |
| **Preview** | Dry-run showing what files would be created/modified |
| **Scan Components** | Scan local workspace components and show a coverage report |

## Configuration

The `.component-library.json` file supports:

- **brand** — colours, fonts
- **components** — root path, group exclusions, thumbnail file names, layout folder
- **features** — search, group filters, lightbox, code snippets, readme, dark mode
- **output** — servlet package, clientlib category, content path, page title
- **serviceUser** — service user name, sub-service, bundle symbolic name
- **hero** — badge, title, description, stats, footer

See the included `USER_MANUAL.md` for the full reference.

## Requirements

- VS Code 1.85+
- AEM Maven multi-module project (`core/`, `ui.apps/`, `ui.config/`, `ui.content/`)
# aem-component-catalog-vs-extension
