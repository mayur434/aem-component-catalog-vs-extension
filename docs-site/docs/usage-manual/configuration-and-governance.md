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

Next: [Generation Safety & CI](./generation-safety-and-ci).
