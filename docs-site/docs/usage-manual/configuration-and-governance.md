---
sidebar_position: 3
---

# Configuration & Governance

## Configuration schema

`.component-library.json` uses `schemaVersion: 2`. Unversioned v1 configuration is migrated in memory when loaded — save the file to persist the v2 version.

| Section | Covers |
| --- | --- |
| `brand` | Validated colors and the local font stack |
| `components` | JCR root, excluded component groups, thumbnails, and layouts |
| `features` | Catalog search, filters, lightbox, snippets, documentation, quality, dependencies, and accessibility toggles |
| `output` | Java package, clientlib category, content path, page title, and resource type |
| `serviceUser` | The author-only service user and subservice mapping |
| `hero` | Escaped catalog copy and statistics shown on the landing page |
| `catalog` | Author deployment target, cache duration, and API page size |
| `governance` | Policy file location and governance metadata property names |
| `taxonomy` | Two-level catalog grouping: **Category** is the website (the first path segment under the components root, displayed via `categoryLabels`); **Sub Category** is the component's `subCategoryProperty` value when present, otherwise its AEM `componentGroup` |

Unsafe path traversal, invalid Java/resource names, dangerous CSS characters, publish-tier deployment targets, and unsupported cache/page sizes are all rejected before planning ever runs.

## Field reference

Every field below lives in `.component-library.json` (schema v2). Defaults shown are computed from the project's `appId` (the artifact/site identifier you provide at init) unless noted otherwise — see `getDefaults()` in `src/config/defaults.ts`.

### `brand`

Validated hex colors and the local font stack used throughout the generated catalog page and clientlib CSS.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `primary` | color | `#03438E` | Primary brand color |
| `primaryLight` | color | `#024997` | Lighter primary shade |
| `primaryDark` | color | `#002D62` | Darker primary shade |
| `primaryDeeper` | color | `#001B3D` | Deepest primary shade |
| `accent` | color | `#4CADE9` | Accent color (CTAs, highlights) |
| `accentHover` | color | `#3A9AD6` | Accent hover state |
| `gold` | color | `#FFD700` | Secondary accent |
| `sky` | color | `#00ABE8` | Secondary accent |
| `background` | color | `#F4F7FB` | Page background |
| `font` | string | `articulat-cf` | Primary font family (Typekit/Adobe Fonts name or any locally available family) |
| `fontFallback` | string | `Roboto, sans-serif` | CSS `font-family` fallback stack |

All color fields are validated as hex values; invalid values are rejected at plan time rather than silently written.

### `components`

Where components live, and which ones the catalog hides by default.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `root` | path | `/apps/<appId>/components` | JCR root the scanner walks for components |
| `groups.exclude` | string[] | `['.hidden']` | Component group names hidden from the catalog entirely |
| `groups.labels` | map | `{}` | Friendly display labels for component group keys |
| `exclude.leafNames` | string[] | `['container', 'responsivegrid', 'parsys', 'page', 'xfpage', 'structure', 'root']` | Components whose folder name matches are excluded — these are structural/layout building blocks, not showcase-worthy components |
| `exclude.superTypeTokens` | string[] | `['wcm/components/container', 'wcm/foundation/components/parsys', 'wcm/foundation/components/responsivegrid', 'wcm/components/page', 'wcm/foundation/components/page']` | A component is also excluded if its `sling:resourceSuperType` contains any of these substrings |
| `thumbnails.fileNames` | string[] | `['thumbnail.png', 'thumbnail.svg', 'thumbnail.jpg']` | Candidate thumbnail filenames checked, in order, inside each component's folder |
| `thumbnails.fallbackIcon` | `'grid' \| 'box' \| 'layers' \| string` | `grid` | Icon shown when no thumbnail file is found |
| `layouts.folderName` | string | `layouts` | Subfolder (per component) scanned for layout/variant thumbnails |
| `layouts.exclude` | string[] | `['thumbnail.*']` | Glob-style patterns excluded from the layouts folder listing |

### `features`

Boolean toggles for optional catalog UI capabilities. All default to `true` except `darkMode` and `qualityScore`.

| Field | Default | Notes |
| --- | --- | --- |
| `search` | `true` | Client-side search box |
| `groupFilters` | `true` | Filter by component group/category |
| `lightbox` | `true` | Click-to-enlarge thumbnails |
| `codeSnippets` | `true` | Show HTL/dialog usage snippets per component |
| `readme` | `true` | Render each component's README on its detail card |
| `darkMode` | `false` | Dark theme toggle |
| `qualityScore` | `false` | Governance view — quality metrics strip plus Status/Owner/Quality facets. Off by default: the catalog is primarily a designer/business-facing showcase, not a scorecard; turn it on for a more governance-focused rollout |
| `dependencyGraph` | `true` | Show component supertype/dependency relationships |
| `accessibility` | `true` | Accessibility-related metadata and affordances in the UI |

### `output`

Where generated Java, content, and clientlib artifacts are placed, and how the catalog page identifies itself.

| Field | Default | Notes |
| --- | --- | --- |
| `servletPackage` | `com.<appId-with-dots>.core.servlets` | Java package for the generated servlet/services (dashes in `appId` become dots) |
| `clientlibCategory` | `<appId>.componentlibrary` | AEM clientlib category |
| `contentPath` | `/content/<appId>/component-library` | JCR path of the generated catalog page |
| `pageTitle` | `Component Catalog` | `jcr:title` of the generated page |
| `pageResourceType` | `<appId>/components/page/componentlibrary` | `sling:resourceType` of the generated page component |
| `pageSuperType` | `core/wcm/components/page/v3/page` | The page component the catalog page extends — defaults to the WCM core page so the catalog renders even in a reactor with no base page component of its own |
| `assetRoot` | `/content/dam/<appId>/catalog` | DAM folder authors manage component images in (thumbnails + gallery) — author-managed, never written to by generation |

### `serviceUser`

The author-only service user and subservice mapping the generated OSGi configs provision.

| Field | Default | Notes |
| --- | --- | --- |
| `name` | `<appId>-componentlibrary-service` | Deliberately **not** `<appId>-service` — the AEM Project Archetype's own default RepoInit already creates a service user with that name for the site in general. Using a distinct, catalog-specific name keeps the catalog's narrow, read-mostly privilege scope separate from whatever broader permissions the site's general-purpose service user already carries |
| `subServiceName` | `component-library` | Subservice name used in the service-user mapping and in `@Reference`/`ResourceResolverFactory` lookups inside the generated Java code |
| `bundleSymbolicName` | `<appId>.core` | Must match the actual bundle symbolic name of the `core`/`bundle` module the generated Java classes are compiled into — the service-user mapping is scoped to this bundle specifically |

### `hero`

Copy and stats shown on the catalog page's hero/header section. All string fields are HTML-escaped when rendered.

| Field | Type | Default |
| --- | --- | --- |
| `badge` | string | `<appId>` |
| `titlePrefix` | string | `<appId>` |
| `titleHighlight` | string | `Component Catalog` |
| `description` | string | `The unified component ecosystem — auto-discovered from the <appId> codebase.` |
| `stats` | `Array<{ label, value }>` | `[{ label: 'Version', value: 'v1.0' }]` |
| `footerText` | string | `<appId> — Enterprise Component Catalog · Auto-Discovered Design System` |

### `catalog`

Runtime behavior of the generated servlet and its scheduled jobs.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `deploymentTarget` | `'author'` | `author` | Fixed — enterprise catalogs are provisioned on Author only |
| `cacheSeconds` | number | `60` | Response cache duration for the catalog JSON endpoint |
| `pageSize` | number | `250` | Page size for the catalog's paginated API |
| `usageCron` | Quartz cron | `0 0 2 * * ?` | Nightly (02:00) rebuild of the "which pages use this component" usage index |
| `generatorCron` | Quartz cron | `0 30 2 * * ?` | Nightly (02:30) regeneration of the static catalog JSON in DAM, scheduled after `usageCron` |
| `requirePublishedUsage` | boolean | `false` | When `true`, only components with at least one usage on a currently-published page are listed — a not-yet-adopted component stays hidden until some page using it goes live. `false` (default) lists every shipped component regardless of usage, since discovery is the catalog's core purpose |
| `usageIndexName` | string | `<oakIndexPrefix>.componentUsage-custom-1` | AEMaaCS-mandated custom Oak index name (`<2-5 char prefix>.<name>-custom-<version>`); bump the trailing number (never edit in place) if the index definition changes, since AEMaaCS treats each `-custom-N` as a distinct, immutable index revision |
| `serveOnPublish` | boolean | `false` | Whether the catalog endpoint also responds on Publish (it always responds on Author). Enabling this makes component metadata and "where used" page paths reachable by anything that can reach the publish tier — the Dispatcher filter is the real access gate there; this only decides whether the servlet responds at all. Also controls whether Dispatcher allow rules are generated (see [Generated Artifacts](./generated-artifacts)) |

### `governance`

Where the organization policy file lives, and which `.content.xml` property names carry governance metadata.

| Field | Default |
| --- | --- |
| `policyFile` | `.aem-catalog-policy.json` |
| `ownerProperty` | `catalogOwner` |
| `statusProperty` | `catalogStatus` |
| `versionProperty` | `catalogVersion` |
| `tagsProperty` | `catalogTags` |

### `taxonomy`

Two-level catalog grouping, plus optional public-domain link resolution.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `categoryLabels` | map | `{}` | Friendly display label per category key (the first path segment under `components.root`, e.g. `mysite`). An unmapped key is auto-prettified (`mysite` → `Mysite`) |
| `subCategoryProperty` | string | `''` | `.content.xml` property read for the Sub Category grouping; falls back to the component's AEM `componentGroup` when the property is absent or unset |
| `siteDomains` | `SiteDomainEntry[]` | `[]` | Opt-in per-category domain mapping — see below. An empty array means the SiteDomainService feature is not generated at all (see [Generated Artifacts](./generated-artifacts)) |

Each `siteDomains` entry:

| Field | Notes |
| --- | --- |
| `category` | Must match a `categoryLabels`/components-root category key |
| `prodDomain` | Public production domain for that site, e.g. `https://www.example.com`. Empty is valid ("not configured yet") and keeps the old relative-link behavior |
| `stageDomain` | Public staging domain for that site |
| `shortenPath` | Free-text path prefix (mirroring the site's own `dispatcher/src/conf.d/rewrites/rewrite.rules`) stripped from the raw JCR content path before appending the domain — e.g. `/content/mysite` if Dispatcher rewrites strip that prefix. Leave empty to keep the full raw path (the safe default when the rewrite behavior isn't confirmed yet) |

## Governance metadata

Add these properties to a component's `.content.xml` to make it visible to governance tooling:

```xml
catalogOwner="design-system-team"
catalogStatus="active"
catalogVersion="2.1.0"
catalogTags="[commerce,shared]"
```

Property names are configurable via the `governance` configuration section. Default lifecycle statuses are `draft`, `active`, and `deprecated`.

## Organization policy

`aem-catalog init` creates `.aem-catalog-policy.json`:

```json
{
  "schemaVersion": 1,
  "extends": ["recommended-aemaacs"],
  "rules": {
    "component.require-owner": "error",
    "component.require-readme": "error",
    "component.require-thumbnail": "warning"
  },
  "minimumQualityScore": 80,
  "allowedStatuses": ["draft", "active", "deprecated"]
}
```

Switch the preset to `strict-aemaacs` once the organization is ready to promote recommended warnings to errors — `strict-aemaacs` promotes built-in warnings to errors before any explicit `rules` overrides in the file are applied.

### Policy reference

Severity values are `error`, `warning`, `info`, or `off`.

| Rule | Recommended | Purpose |
| --- | --- | --- |
| `aemaacs.project` | error | Positive Cloud SDK/analyser or standard Cloud structure detection |
| `aemaacs.modules` | error | Required reactor modules and recommended Dispatcher module |
| `aemaacs.package-separation` | error | Immutable `/apps` vs. mutable content boundaries |
| `aemaacs.all-embeds` | warning | `all` container references core deployment artifacts |
| `aemaacs.repoinit` | error | RepoInit OSGi JSON and script shape |
| `catalog.author-only` | error | Catalog configuration and provisioning remain on Author |
| `catalog.config` | error | v2 configuration and structural consistency |
| `catalog.generated-drift` | warning | Conflicts, stale owned output, and orphaned manifest entries |
| `component.require-dialog` | warning | Author dialog exists |
| `component.require-readme` | warning | README documentation exists |
| `component.require-thumbnail` | warning | Thumbnail, or a configured layout fallback, exists |
| `component.require-owner` | warning | Ownership metadata exists |
| `component.require-status` | warning | Lifecycle status is one of the allowed values |
| `component.require-version` | info | Component version exists |
| `component.minimum-quality` | warning | Explainable score meets `minimumQualityScore` |

## Component quality

The default score is explainable and deterministic:

| Capability | Weight |
| --- | ---: |
| Author dialog | 25 |
| README | 20 |
| Thumbnail | 15 |
| Owner | 15 |
| Lifecycle status | 15 |
| Version | 10 |

Cloud Doctor can enforce a minimum score via `component.minimum-quality`. Scanning also inventories dialog fields, design dialogs, supertype dependencies, Sling Models, JSON exporters, and local content usages for each component.

## Cloud Doctor

Doctor validates:

- Positive AEMaaCS identification
- Required Maven modules and the Cloud Dispatcher module (`dispatcher` or `dispatcher.cloud`)
- FileVault mutable/immutable package separation
- `all` container embeds
- RepoInit JSON shape and author run-mode placement
- Configuration and organization policy validity
- Component documentation and governance metadata completeness
- Generated-file conflicts, stale output, and orphaned manifest entries

Severity for every check is controlled through `.aem-catalog-policy.json`; `off` disables a rule entirely. SARIF output can be uploaded directly by CI code-scanning systems (e.g. as a GitHub Advanced Security check).

Next: [Generated Artifacts](./generated-artifacts) — exact paths and functionality of everything generation writes.
