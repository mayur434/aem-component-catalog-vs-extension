# AEM Component Library Generator — User Manual

> **Version:** 1.0.0  
> **Platform:** VS Code Extension (TypeScript)  
> **Compatibility:** AEM 6.5 / AEM as a Cloud Service

---

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Quick Start (5-minute guide)](#quick-start)
4. [Commands Reference](#commands-reference)
5. [Configuration File](#configuration-file)
6. [Generated Files](#generated-files)
7. [Deployment](#deployment)
8. [Customisation](#customisation)
9. [Updating & Re-generating](#updating--re-generating)
10. [Troubleshooting](#troubleshooting)
11. [Architecture](#architecture)

---

## 1. Overview

The **AEM Component Library Generator** is a VS Code extension that auto-scaffolds a fully functional, brand-aligned component library for any AEM project. It generates:

| Artifact | Description |
|----------|-------------|
| **Servlet** | Java Sling servlet that auto-discovers all components under `/apps/<appId>/components` and returns JSON |
| **Page Component** | HTL page component with hero, toolbar, card grid, detail view, lightbox, and footer |
| **Client Library** | JavaScript (search, filtering, detail view, lightbox, markdown renderer) and CSS (brand tokens, responsive design) |
| **OSGi Configs** | Service user mapper + repository init for secure servlet access |
| **Content Page** | JCR content page definition so the library is accessible at a URL |

Everything is **parameterised** — brand colours, fonts, hero text, feature flags, and paths are all driven by a single `.component-library.json` configuration file.

---

## 2. Installation

### Prerequisites

- **macOS** (tested on macOS; also works on Linux/Windows)
- **Node.js** 18+ and **npm** (`brew install node` if not installed)
- **VS Code** 1.85+
- An AEM Maven multi-module project with the standard layout:
  ```
  my-project/
  ├── core/           ← Java (servlet goes here)
  ├── ui.apps/        ← Components, clientlibs, page component
  ├── ui.config/      ← OSGi configs
  └── ui.content/     ← Content pages
  ```

### Option A — Install from VSIX (Recommended)

If you already have the `.vsix` file, install it directly:

```bash
# Install the extension into VS Code
code --install-extension /path/to/aem-component-library-generator-1.0.0.vsix
```

Then **reload VS Code** (`Cmd+Shift+P` → "Developer: Reload Window").

### Option B — Build & Install from Source (macOS)

```bash
# 1. Clone or navigate to the extension source
cd /path/to/vscode-aem-component-library

# 2. Install dependencies
npm install

# 3. Compile TypeScript
npx tsc

# 4. Install the vsce packaging tool (one-time)
npm install -g @vscode/vsce

# 5. Build the VSIX package
vsce package --allow-missing-repository

# 6. Install into VS Code
code --install-extension aem-component-library-generator-1.0.0.vsix

# 7. Reload VS Code
#    Cmd+Shift+P → "Developer: Reload Window"
```

### Option C — Development Mode (for contributors)

```bash
cd /path/to/vscode-aem-component-library
npm install
npx tsc
```

Then open the extension folder in VS Code and press `F5` to launch the Extension Development Host.

### Verify Installation

After installing, confirm the extension is active:

```bash
# List installed extensions (should show aem-component-library-generator)
code --list-extensions | grep aem-component
```

You should also see a **$(layers) AEM CL** button in the VS Code status bar (bottom-right).

### Uninstall

```bash
code --uninstall-extension pidilite.aem-component-library-generator
```

Or: VS Code → Extensions sidebar (`Cmd+Shift+X`) → search "AEM Component Library" → Uninstall.

---

## 3. Quick Start

### Step 1 — Initialise

1. Open your AEM project folder in VS Code
2. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run **"AEM Component Library: Init"**
4. Answer the prompts:
   - **Library title** (e.g. "My Brand Component Library")
   - **Primary brand colour** (hex, e.g. `#03438E`)
   - **Body font** (e.g. `Roboto`)

This creates `.component-library.json` at the project root.

### Step 2 — Preview (Optional)

Run **"AEM Component Library: Preview"** to see a dry-run of all files that will be created or updated — without writing anything to disk.

### Step 3 — Generate

Run **"AEM Component Library: Generate"** to scaffold all files:

- `core/src/.../ComponentLibraryServlet.java`
- `ui.apps/src/.../page/componentlibrary/body.html`
- `ui.apps/src/.../clientlibs/clientlib-componentlibrary/js/scripts.js`
- `ui.apps/src/.../clientlibs/clientlib-componentlibrary/css/styles.css`
- `ui.config/src/.../osgiconfig/.../*.cfg.json`
- `ui.content/src/.../content/<appId>/component-library/.content.xml`

### Step 4 — Build & Deploy

```bash
mvn clean install -PautoInstallSinglePackage -DskipTests
```

### Step 5 — View

Open your browser:
```
http://localhost:4502/content/<appId>/component-library.html
```

You should see your fully branded component library with all components auto-discovered.

---

## 4. Commands Reference

All commands are available via the Command Palette (`Cmd+Shift+P`).

| Command | ID | Description |
|---------|----|-------------|
| **AEM Component Library: Init** | `aemComponentLibrary.init` | Detect the AEM project, prompt for brand settings, and create `.component-library.json` |
| **AEM Component Library: Generate** | `aemComponentLibrary.generate` | Generate all component library files from the config |
| **AEM Component Library: Update** | `aemComponentLibrary.update` | Re-generate files that haven't been manually modified (manifest-aware) |
| **AEM Component Library: Preview** | `aemComponentLibrary.preview` | Dry-run showing which files would be created/updated |
| **AEM Component Library: Scan Components** | `aemComponentLibrary.scan` | Scan local workspace for AEM components and show a coverage report |

### Status Bar

A **$(layers) AEM CL** button appears in the status bar. Click it to run the Generate command.

---

## 5. Configuration File

The `.component-library.json` file drives all generation. It's created by the Init command and can be edited manually. VS Code provides IntelliSense and validation via the bundled JSON schema.

### Full Example

```json
{
  "appId": "mysite",
  "brand": {
    "primary": "#03438E",
    "primaryLight": "#024997",
    "primaryDark": "#002D62",
    "primaryDeeper": "#001B3D",
    "accent": "#4CADE9",
    "accentHover": "#3A9AD6",
    "gold": "#FFD700",
    "goldHover": "#E6C200",
    "sky": "#00ABE8",
    "headingFont": "articulat-cf",
    "bodyFont": "Roboto"
  },
  "hero": {
    "badge": "My Company",
    "title": "My Company Component Library",
    "titleHighlight": "My Company",
    "titleSuffix": "Component Library",
    "description": "The unified component ecosystem — auto-discovered from the codebase.",
    "stats": [
      { "value": "3", "label": "Brands" },
      { "value": "v1.0", "label": "Version" }
    ]
  },
  "components": {
    "root": "/apps/mysite/components",
    "groups": {
      "exclude": [".hidden"]
    },
    "thumbnails": {
      "fileNames": ["thumbnail.png", "thumbnail.svg", "thumbnail.jpg"]
    },
    "layouts": {
      "folderName": "layouts",
      "exclude": ["thumbnail*"]
    }
  },
  "features": {
    "search": true,
    "groupFilter": true,
    "lightbox": true,
    "codeSnippets": true,
    "readme": true,
    "gallery": true
  },
  "output": {
    "servletPackage": "com.mysite.core.servlets",
    "pageResourceType": "mysite/components/page/componentlibrary",
    "clientlibCategory": "mysite.componentlibrary",
    "contentPath": "/content/mysite/component-library"
  },
  "serviceUser": {
    "systemUser": "mysite-service",
    "subServiceName": "component-library",
    "bundleSymbolicName": "mysite.core"
  }
}
```

### Key Sections

#### `appId`
The root identifier for your AEM project. Must match the folder name under `/apps/`.

#### `brand`
All CSS custom properties are derived from these values. Changing `brand.primary` updates the entire colour scheme.

#### `hero`
Controls the hero section at the top of the component library page.

#### `components`
- **root**: JCR path where the servlet scans for `cq:Component` nodes
- **groups.exclude**: Component groups to hide (e.g. `.hidden`)
- **thumbnails.fileNames**: The servlet checks for these files in each component folder
- **layouts.folderName**: Subfolder containing layout screenshots
- **layouts.exclude**: Glob patterns within layouts/ to skip (e.g. `thumbnail*` goes to card, not gallery)

#### `features`
Toggle individual features on/off. Disabled features are excluded from the generated JS/HTML.

#### `output`
Controls file placement:
- **servletPackage**: Java package for the servlet
- **pageResourceType**: Sling resource type for the page component
- **clientlibCategory**: AEM clientlib category name
- **contentPath**: Where the content page is created in the JCR

#### `serviceUser`
The servlet uses a service user for secure JCR access. These values configure the OSGi service user mapper and repoinit scripts.

---

## 6. Generated Files

### Servlet (`ComponentLibraryServlet.java`)

**Location:** `core/src/main/java/<package>/ComponentLibraryServlet.java`

- Registered with `@SlingServletResourceTypes` (not deprecated path-based binding)
- Auto-discovers all `cq:Component` nodes under the configured root
- Returns JSON with: `total`, `groups` (with counts), `components` array
- Each component includes: name, title, description, group, resourceType, superType, isContainer, hasDialog, hasEditConfig, readmePath, thumbnailPath, layouts[]
- Uses a service user for secure access

### Page Component

**Location:** `ui.apps/src/.../components/page/componentlibrary/`

| File | Purpose |
|------|---------|
| `.content.xml` | Component definition (hidden group, extends base page) |
| `body.html` | HTL shell — hero, toolbar, content area, lightbox, footer |
| `customheaderlibs.html` | Loads the clientlib CSS |
| `customfooterlibs.html` | Loads the clientlib JS |

### Client Library

**Location:** `ui.apps/src/.../clientlibs/clientlib-componentlibrary/`

| File | Purpose |
|------|---------|
| `.content.xml` | Clientlib definition with category |
| `js.txt` | JS file manifest |
| `css.txt` | CSS file manifest |
| `js/scripts.js` | All JavaScript — fetch, render listing, render detail, search, filter, lightbox, markdown |
| `css/styles.css` | All CSS — brand tokens, hero, toolbar, cards, detail, gallery, lightbox, responsive |

### OSGi Configs

**Location:** `ui.config/src/.../osgiconfig/config/`

| File | Purpose |
|------|---------|
| `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-componentlibrary.cfg.json` | Maps bundle:subservice → system user |
| `org.apache.sling.jcr.repoinit.RepositoryInitializer-componentlibrary.cfg.json` | Creates service user + sets ACLs |

### Content Page

**Location:** `ui.content/src/.../content/<appId>/component-library/.content.xml`

Creates the `cq:Page` node so the library is accessible at the configured URL.

---

## 7. Deployment

### Local AEM (SDK)

```bash
# Full build
mvn clean install -PautoInstallSinglePackage -DskipTests

# Just the core bundle (servlet only)
mvn clean install -PautoInstallBundle -pl core -DskipTests

# Just ui.apps (page component + clientlib)
mvn clean install -PautoInstallPackage -pl ui.apps -DskipTests
```

### Cloud Manager

Commit the generated files to your repository. Cloud Manager builds and deploys the standard modules.

### Service User Setup

If you're on **AEM 6.5** (not Cloud), you may need to manually create the service user in the Security console:

1. Go to `http://localhost:4502/crx/explorer/index.jsp`
2. Create system user: `<your-service-user>`
3. Set read permissions on `/apps/<appId>/components` and `/apps/<appId>/clientlibs`

On **AEM as a Cloud Service**, the repoinit config handles this automatically.

---

## 8. Customisation

### Changing Brand Colours

Edit `.component-library.json`:

```json
{
  "brand": {
    "primary": "#E63946",
    "primaryLight": "#F04E5C",
    "primaryDark": "#C41E30",
    "primaryDeeper": "#8B0000"
  }
}
```

Then run **"AEM Component Library: Update"**.

### Adding Custom Hero Stats

```json
{
  "hero": {
    "stats": [
      { "value": "5", "label": "Brands" },
      { "value": "v2.1", "label": "Version" },
      { "value": "12", "label": "Markets" }
    ]
  }
}
```

### Disabling Features

```json
{
  "features": {
    "lightbox": false,
    "readme": false
  }
}
```

### Custom Modifications

After generating, you can freely edit any generated file. The **Update** command uses a manifest (`.clgen-manifest.json`) to track file hashes. If you modify a file manually, Update will **skip** it and report which files were not updated.

To force a full re-generation (overwriting manual changes):
1. Delete `.clgen-manifest.json`
2. Run **Generate** again

---

## 9. Updating & Re-generating

### Update (Safe)

```
Cmd+Shift+P → AEM Component Library: Update
```

- Only regenerates files whose content matches the manifest hash
- Files you modified manually are preserved
- Shows a summary: "3 files updated, 1 skipped (manually modified): styles.css"

### Full Regenerate

```
Cmd+Shift+P → AEM Component Library: Generate
```

- Overwrites all files
- Resets the manifest
- Use when you want a clean slate

---

## 10. Troubleshooting

### "No AEM project found"

Make sure your workspace root contains a `pom.xml` with `<packaging>pom</packaging>` and sub-modules like `core`, `ui.apps`, etc.

### Servlet returns empty data

1. **Bundle active?** Check `http://localhost:4502/system/console/bundles` — search for your bundle
2. **Service user mapped?** Check `http://localhost:4502/system/console/configMgr` → search "Service User Mapper"
3. **ACLs set?** Check `http://localhost:4502/system/console/configMgr` → search "Repository Initializer"
4. **Components exist?** Verify `/apps/<appId>/components` has `cq:Component` nodes with `componentGroup` property

### Servlet returns 404

The page component's `sling:resourceType` must match the servlet's `@SlingServletResourceTypes`. The JS calls `<pagePath>/_jcr_content.components.json` — this resolves against the `jcr:content` node's resource type.

### Styles not loading

1. Check the clientlib category matches in the config
2. Verify `customheaderlibs.html` and `customfooterlibs.html` exist in the page component
3. Check browser console for 404s on CSS/JS

### "Service user authentication failed"

The repoinit config needs to be deployed. On local AEM:

```bash
mvn clean install -PautoInstallSinglePackage -pl ui.config -DskipTests
```

### SVG images collapse to 0×0 in lightbox

This is handled by the generated CSS (`width: 80vw; max-width: 900px` on `.pcl-lightbox__content`, `width: 100%; height: auto` on the `img`). If you see this after customising styles, ensure these rules are present.

---

## 11. Architecture

### How It Works

```
┌─────────────────────────────────────────────────┐
│               VS Code Extension                  │
│                                                   │
│  Init ──► .component-library.json                │
│                    │                              │
│  Generate ──► Handlebars Templates + Config      │
│                    │                              │
│                    ▼                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Servlet  │  │   Page   │  │ Clientlib │       │
│  │  (Java)   │  │  (HTL)   │  │ (JS+CSS)  │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│  ┌──────────┐  ┌──────────┐                      │
│  │  OSGi    │  │ Content  │                      │
│  │ Configs  │  │  Page    │                      │
│  └──────────┘  └──────────┘                      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                  AEM Runtime                      │
│                                                   │
│  Browser ──► /content/<app>/component-library     │
│                    │                              │
│         ┌──────────┴──────────┐                  │
│         │ Page Component      │                  │
│         │ (body.html)         │                  │
│         └──────────┬──────────┘                  │
│                    │                              │
│    JS calls /_jcr_content.components.json        │
│                    │                              │
│         ┌──────────┴──────────┐                  │
│         │ Servlet              │                  │
│         │ (service user)       │                  │
│         └──────────┬──────────┘                  │
│                    │                              │
│    Scans /apps/<app>/components                  │
│    Returns JSON: components + groups + metadata  │
│                    │                              │
│    JS renders listing OR detail (suffix routing)  │
└─────────────────────────────────────────────────┘
```

### File Manifest

The `.clgen-manifest.json` file tracks generated files:

```json
{
  "version": 1,
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "configHash": "a1b2c3...",
  "files": {
    "/path/to/servlet.java": {
      "hash": "d4e5f6...",
      "generatedAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

This enables the **Update** command to detect manual modifications and skip those files.

---

## FAQ

**Q: Can I use this with multiple AEM projects in the same workspace?**  
A: Yes. The Init command detects all AEM projects and lets you pick one. Each project gets its own `.component-library.json`.

**Q: Does the servlet work on AEM as a Cloud Service?**  
A: Yes. It uses `@SlingServletResourceTypes` (not the deprecated path-based approach) and repoinit for service user creation.

**Q: Can I change the page URL?**  
A: Yes. Edit `output.contentPath` in the config, then re-generate.

**Q: What if I want to add custom sections to the detail view?**  
A: Edit `scripts.js` after generation. The Update command will detect your changes and skip `scripts.js` on future updates.

**Q: How do I add component thumbnails?**  
A: Place a `thumbnail.png` (or `.svg`/`.jpg`) file directly inside each component folder under `/apps/<appId>/components/<component-name>/`. The servlet picks these up automatically.

**Q: How do I add layout screenshots?**  
A: Create a `layouts/` folder inside each component folder and add `.png`, `.svg`, `.jpg`, or `.webp` images. These appear in the detail view gallery. Files matching `thumbnail*` go to the card view instead.

---

*Generated by AEM Component Library Generator v1.0.0*
