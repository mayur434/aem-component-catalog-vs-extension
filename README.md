# AEM Component Catalog

Configure, generate, and deploy a browsable component showcase for **Adobe Experience Manager as a Cloud Service (AEMaaCS) and AEM as a Managed Service (AMS)**. Component discovery, governance, and safe generation tooling are available as advanced/optional features.

The project includes both a VS Code extension and the `aem-catalog` headless CLI. They use the same validation, policy, planning, and transaction engine, so local development and CI produce the same result.

## Enterprise capabilities

- AEMaaCS and AEM AMS project detection, with AEMaaCS-specific package-boundary validation
- AEM Cloud Doctor (AEMaaCS-specific) with organization policy packs and SARIF output
- Recursive component inventory with dialog fields, Sling Models, exporters, usages, dependencies, owners, versions, tags, and lifecycle status
- Explainable component quality score
- Complete generation plans with per-file diffs and conflict detection
- Atomic generation, manual-change preservation, rollback snapshots, and local audit records
- Author-only catalog provisioning through `ui.config/config.author`
- Cached servlet metadata with resource-change invalidation and pagination
- Strict VS Code webview CSP, allow-listed messages, path containment, and Workspace Trust support
- Sanitized README rendering and escaped generated content
- JSON, CSV, Markdown, and SARIF reports
- Redacted diagnostic support bundles and a checksummed template registry
- Cross-platform CI, dependency review, SBOM creation, VSIX packaging, and release provenance

## Requirements

- VS Code 1.100+
- Node.js 20+ for source development or CLI use
- An AEMaaCS or AEM AMS Maven reactor
- AEMaaCS: `core`, `ui.apps`, `ui.config`, `all`, plus Cloud SDK/Analyser markers; the current archetype `dispatcher` module (and legacy `dispatcher.cloud` name) is supported
- AMS: an `uber-jar`/`cq-quickstart` dependency with a Java module (`core` or `bundle`) and a content module (`ui.apps` or `content`)

AEM 6.5 and on-premise (non-Cloud, non-AMS) projects are intentionally unsupported. AEM Cloud Doctor's governance checks are AEMaaCS-specific.

## Quick start in VS Code

1. Open the AEMaaCS or AEM AMS reactor, or a workspace containing one or more reactors.
2. Run **AEM Component Catalog: Configure & Generate Micro-site** (or open the Catalog panel from the status bar / sidebar). It writes sensible defaults on first run — nothing to hand-edit.
3. Deploy to local AEM from the same panel, then open the generated catalog page on Author.
4. (AEMaaCS, advanced, optional) Add governance metadata to component definitions and run **AEM Component Catalog: (Advanced) Run AEM Cloud Doctor** for a portfolio-wide health check — this never blocks generation.
5. Use the **Audit** tab in the Catalog panel for a cross-project tech audit (classification, duplicates, usage, Excel export) across both platforms.

Generation is disabled in an untrusted workspace. The extension never silently overwrites manually changed files.

## CLI

```bash
npm ci
npm run compile

node out/cli.js init --project /path/to/aem-project --yes
node out/cli.js doctor --project /path/to/aem-project
node out/cli.js doctor --project /path/to/aem-project --format sarif --output doctor.sarif
node out/cli.js scan --project /path/to/aem-project --format csv --output components.csv
node out/cli.js plan --project /path/to/aem-project
node out/cli.js generate --project /path/to/aem-project --yes
node out/cli.js rollback --project /path/to/aem-project --yes
node out/cli.js support --project /path/to/aem-project --output support.json
```

`generate` refuses Cloud Doctor errors by default. `--force` is explicit and also permits overwriting conflicts; use it only after reviewing the plan.

## Governance metadata

Add these properties to each component `.content.xml`:

```xml
catalogOwner="design-system-team"
catalogStatus="active"
catalogVersion="2.1.0"
catalogTags="[commerce,shared]"
```

The property names are configurable. Default lifecycle statuses are `draft`, `active`, and `deprecated`.

## Organization policy

Init creates `.aem-catalog-policy.json`:

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

Change the preset to `strict-aemaacs` when the organization is ready to promote recommended warnings to errors. See [Policy Reference](docs/POLICY_REFERENCE.md) for every built-in rule.

## Safe generation model

The engine renders the complete desired artifact set before writing anything. Every output is classified as `create`, `update`, `unchanged`, or `conflict`.

- Existing files without a matching ownership hash are conflicts.
- Safe generation preserves conflicts.
- Writes use a temporary sibling file and atomic rename.
- Existing contents and the ownership manifest are backed up before changes.
- Any failure rolls back files already written.
- `.aem-catalog/audit.jsonl` records hashes and outcomes without file content.
- **Roll Back Last Generation** restores the latest successful transaction.

The local `.aem-catalog/` state directory is ignored by Git. The portable ownership file `.aem-catalog-manifest.json` may be committed so every developer and CI agent shares drift detection.

## Generated AEMaaCS artifacts

- Resource-type servlet under `core`
- Page rendering component and client library under `ui.apps`
- Service-user mapping and RepoInit under `ui.config/.../config.author`
- Author content page and baseline template created by RepoInit

The runtime servlet checks the `author` run mode and returns `404` elsewhere. No Cloud Manager, RDE, AEM, or Adobe credentials are stored by the extension.

## Architecture and data flow

### Dev-time: configure → scan → generate

```mermaid
flowchart TD
    A["VS Code Extension UI<br/>(Catalog Panel / Sidebar)"] -->|same core| B["Headless CLI"]
    A --> C[Config Loader & Schema]
    B --> C
    C --> D["Project Detector<br/>(AEMaaCS / AMS reactor discovery)"]
    D --> E["Component Scanner<br/>(dialogs, Sling Models, exporters,<br/>usages, deps, owners, tags, status)"]
    E --> F["Quality Scorer<br/>(explainable per-component score)"]
    E --> G["Policy Engine<br/>(.aem-catalog-policy.json rules)"]
    G --> H["AEM Cloud Doctor<br/>(governance checks, SARIF output)"]
    F --> I["Generation Planner<br/>(diff plan: create / update / unchanged / conflict)"]
    G --> I
    I --> J["Atomic Transaction Engine<br/>(temp-file + rename, backup, rollback)"]
    J --> K["Ownership Manifest<br/>(.aem-catalog-manifest.json)"]
    J --> L["Local Audit Log<br/>(.aem-catalog/audit.jsonl)"]
    J --> M["Generated AEM Artifacts"]

    M --> M1["core: Resource-type Servlet<br/>+ CatalogGeneratorService (scheduled job)"]
    M --> M2["ui.apps: Page component + Client Library"]
    M --> M3["ui.config/config.author: Service user + RepoInit"]
    M --> M4["Author content page + baseline template"]
```

### Runtime: how the microsite serves data on AEM Author

```mermaid
flowchart TD
    subgraph Authoring["Author-managed content (no deploy)"]
        DAM["DAM: /content/dam/&lt;app&gt;/catalog/&lt;component&gt;<br/>thumbnail + gallery images"]
        SRC["/apps component sources<br/>.content.xml + README.md<br/>(owner, status, version, tags)"]
    end

    subgraph Bundle["core bundle (OSGi)"]
        GEN["CatalogGeneratorService<br/>(scheduled: 10 min after startup + daily cron)"]
        SERVLET["ComponentLibraryServlet<br/>(run-mode gated: author only)"]
        CACHE["In-memory Cache<br/>(TTL-based)"]
    end

    SRC -->|traverses /apps via service user| GEN
    DAM -->|reads thumbnail/gallery paths| GEN
    GEN -->|writes JSON, falls back to /content if DAM write fails| STATIC["Static Catalog JSON<br/>/content/dam/.../components-catalog.json"]

    REQ["Browser request:<br/>/apps/.../components-catalog.html"] --> SERVLET
    SERVLET --> CACHE
    CACHE -->|cache miss| STATIC
    STATIC -->|"loadFromDam() → loadFromContent() fallback"| SERVLET
    SERVLET -.->|"if no static JSON yet"| SRC
    SERVLET --> RESP["JSON response:<br/>components + groups + categories + avg quality score"]

    RESP --> UI["Catalog Frontend (HTL + JS + CSS)"]
    UI --> CARD["Component Card:<br/>DAM thumbnail + name + owner + status + score"]
    UI --> DETAIL["Detail View:<br/>DAM gallery images + rendered README (sanitized)"]
```

Key properties: a single core shared by the extension and CLI, author-only servlet exposure, a nightly pre-computed JSON to avoid live `/apps` traversal at request time, author-managed images/READMEs decoupled from code deploys, and atomic/reversible generation. See [Architecture](docs/ARCHITECTURE.md) for module boundaries and extension points.

## Development

```bash
npm ci
npm run quality
npm run test:coverage
npm run test:integration
npm run compile
npm run package:vsix
```

Architecture and extension points are documented in [Architecture](docs/ARCHITECTURE.md). Operational rollout guidance is in [Enterprise Operations](docs/ENTERPRISE_OPERATIONS.md).

## Build and package the extension

```bash
npm ci               # install dependencies
npm run compile       # type-check + bundle (out/extension.js, out/cli.js)
npm run package:vsix   # produces the installable .vsix
```

`package:vsix` runs `vsce package`, which re-runs `compile` via `vscode:prepublish` and writes the VSIX to the project root:

```text
aem-component-library-generator-<version>.vsix
```

For example, version `2.1.0` produces `aem-component-library-generator-2.1.0.vsix` in the repository root. Install it locally with:

```bash
code --install-extension aem-component-library-generator-2.1.0.vsix
```

Or, in VS Code: **Extensions view → `···` menu → Install from VSIX…**.

## Security and privacy

The extension does not collect telemetry. Support bundles are generated locally and redact project-root paths and secret-like configuration keys. Review [SECURITY.md](SECURITY.md) before reporting a vulnerability.

Licensed under the [MIT License](LICENSE).
