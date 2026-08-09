# Changelog

## 2.1.0 — 2026-08-08

### Fixed

- AEM AMS reactors were silently mis-scanned in several places that only ever checked the AEMaaCS module-naming convention: component discovery, Sling Model detection, usage indexing, and Java package detection now try both `core`/`bundle` and `ui.apps`/`content` regardless of platform.
- Local deploy no longer excludes AMS projects — `bundle` is now an accepted deploy target alongside `core`, `ui.apps`, `ui.config`. `ui.content` (and AMS's `content` module) remain permanently excluded from any deployable module list.
- A corrupted content package ZIP could previously crash an entire tech audit run; a single bad package (or a single unreadable path) is now skipped instead.
- The Configure tab's theme auto-detection (scanning clientlib CSS for brand colors) only ever checked the `ui.apps` module; it now checks both AEMaaCS and AMS component roots.
- The generated catalog's sort dropdown defaulted its UI to "Latest updated" while the client script's own fallback assumed "Most used" — the two now agree.

### Changed

- The separate Dashboard, Configure & Generate, and Tech Audit webview panels are now one tabbed **Catalog panel** (Overview / Configure / Audit) that preserves each tab's state when you switch between them. Opened via the new `aemComponentLibrary.openCatalog` command.
- The sidebar's flat "Actions" list is removed. The sidebar is now pure navigation (Projects, Components); actions live in the Catalog panel and in a project's right-click context menu.
- Component/model/usage directory discovery and the local-deploy allowlist are now sourced from one shared `PlatformAdapter` module instead of being duplicated across four files.

### Added

- A stub Edge Delivery Services (EDS) platform adapter, laying the groundwork for future EDS support. EDS project detection itself is not yet wired up.

### Removed

- The `aemComponentLibrary.openDashboard` command (replaced by `aemComponentLibrary.openCatalog`). Any keybinding or script referencing the old command ID will need to be updated.

## 2.0.0 — 2026-07-22

### Added

- AEMaaCS-only project discovery and Cloud package validation
- AEM Cloud Doctor, policy presets, Markdown/JSON/SARIF reports, and CI exit codes
- Recursive component metadata, dialog fields, Sling Models, exporters, usages, dependencies, and quality scoring
- Complete generation plans, conflict preservation, atomic writes, rollback, and audit history
- Author-only RepoInit and runtime enforcement
- Runtime cache invalidation, paging, governance metadata, and hardened README rendering
- Secure CSP dashboard, Workspace Trust, and project-ID message routing
- Headless CLI, CSV/JSON exports, template registry, and redacted support bundles
- Unit/fixture tests, cross-platform CI, release packaging, SBOM, and provenance

### Changed

- Configuration schema upgraded to version 2 with automatic v1 migration
- Ownership manifest upgraded to portable project-relative version 2
- Minimum supported VS Code version is now 1.100

### Removed

- AEM 6.5 and AMS detection, generators, templates, and documentation
