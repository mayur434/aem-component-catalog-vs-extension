---
sidebar_position: 3
---

# Supporting Stack & Architecture

## Design goal

The extension is a thin VS Code adapter around a deterministic core. AEM project data is a local input; no remote service or credential is required to run it.

```text
VS Code commands/dashboard ─┐
                           ├─> configuration + AEMaaCS discovery
Headless CLI ──────────────┘              │
                                          ├─> component scanner + quality
                                          ├─> Cloud Doctor + policy + SARIF
                                          └─> generation planner
                                                   │
                                                   └─> atomic transaction + manifest + audit
```

Both entry points — the VS Code commands/dashboard and the headless CLI — call into the same core functions, which is what guarantees a local run and a CI run produce the same result.

## Dev-time data flow: configure → scan → generate

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

## Runtime data flow: how the microsite serves data on AEM Author

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

## Technology stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript 5.9 (`strict` project config, `tsc --noEmit` as a dedicated `check` script) |
| Extension host | VS Code Extension API `^1.100.0`, `workspace` extension kind |
| Bundler | esbuild (`esbuild.mjs`), including a `--watch` dev mode |
| CLI | Node.js 20+, packaged as the `aem-catalog` binary (`out/cli.js`) |
| Templating | Handlebars — renders the generated Java, HTL, clientlib, and OSGi artifacts |
| XML parsing | fast-xml-parser — reads JCR `.content.xml` sources during scanning |
| Reporting | ExcelJS (Tech Audit `.xlsx` output), native JSON/CSV/Markdown/SARIF writers |
| Packaging | adm-zip (VSIX/zip handling), `@vscode/vsce` (VSIX packaging) |
| Testing | Vitest (unit + coverage via `@vitest/coverage-v8`), `@vscode/test-electron` (integration tests against a real VS Code instance) |
| Linting/formatting | ESLint 9 + typescript-eslint, Prettier |
| Supply chain | `npm sbom --sbom-format cyclonedx`, GitHub release provenance |

No AEM, Cloud Manager, RDE, or Adobe credentials are stored or required by the extension — it operates entirely on the local Maven reactor's source files.

## Module boundaries

| Path | Responsibility |
| --- | --- |
| `src/core` | Policy, quality scoring, Cloud Doctor, SARIF output, generation plans, transactions, template registry, and supportability (support bundles) |
| `src/scanner` | Maven and JCR source discovery |
| `src/generators` | Pure artifact recipes — computes desired file content, performs **no file writes** itself |
| `src/config` | Versioned configuration schema, migration (v1 → v2), defaults, and validation |
| `src/audit` | The separate Tech Audit Report engine: component classification, content-package parsing, duplicate detection, Excel reporting |
| `src/commands`, `src/sidebar`, `src/webview` | VS Code adapters — commands, tree views, and the dashboard/config-panel/audit-panel webviews |
| `src/cli.ts` | The headless CLI adapter |
| `src/templates` | The generated AEM Java, HTL, clientlib, and OSGi artifact templates |

## Invariants the engine holds

1. Only positively identified AEMaaCS reactors are accepted.
2. Generated paths must remain inside the selected reactor.
3. Recipes render every desired artifact before any writes begin.
4. Existing content is changed only when the ownership manifest proves the tool owns it, or the operator explicitly forces it.
5. A failed transaction restores every file already touched.
6. The VS Code webview never supplies a filesystem path to a privileged handler.
7. The generated runtime catalog servlet is author-only, even if its content is accidentally copied elsewhere.
8. CLI and VS Code behavior share the same core functions — no separate code path to drift out of sync.

## Extension points

- **New Cloud Doctor rule** — add it in `core/doctor.ts` plus a default severity in `core/policy.ts`.
- **New scanned metadata** — add it in `scanner/componentScanner.ts`, then surface it through Doctor, the CLI, and the dashboard.
- **New generated artifact** — add a recipe that returns a `GeneratedArtifact` and register it in `buildGenerationPlan`.
- **Template changes** — require a golden generation test; the template registry's checksum makes template-set drift visible.

## Persisted state

| File/directory | Nature |
| --- | --- |
| `.component-library.json` | Committed desired configuration (schema v2) |
| `.aem-catalog-policy.json` | Committed organization policy |
| `.aem-catalog-manifest.json` | Portable ownership state — recommended to commit so every developer and CI agent shares drift detection |
| `.aem-catalog/` | **Not committed** (Git-ignored) — local backups, generation lock, and audit history |

Next: the [Usage Manual](./usage-manual/getting-started).
