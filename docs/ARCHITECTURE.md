# Architecture

## Design goals

The extension is a thin VS Code adapter around a deterministic core. AEM project data is local input; no remote service or credential is required.

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

## Boundaries

- `src/core`: policy, quality, Doctor, SARIF, plans, transactions, templates, and supportability
- `src/scanner`: Maven and JCR source discovery
- `src/generators`: pure artifact recipes; no file writes
- `src/config`: versioned schema, migration, defaults, and validation
- `src/commands`, `src/sidebar`, `src/webview`: VS Code adapters
- `src/cli.ts`: headless adapter
- `src/templates`: generated AEM Java, HTL, clientlib, and OSGi artifacts

## Invariants

1. Only positively identified AEMaaCS reactors are accepted.
2. Generated paths must remain inside the selected reactor.
3. Recipes render every desired artifact before writes begin.
4. Existing content is changed only when the manifest proves ownership or the operator explicitly forces it.
5. A failed transaction restores every file already touched.
6. The VS Code webview never supplies a filesystem path to privileged handlers.
7. The runtime catalog is author-only even if content is accidentally copied elsewhere.
8. CLI and VS Code behavior share the same core functions.

## Extension points

- Add a rule in `core/doctor.ts` and a default level in `core/policy.ts`.
- Add metadata in `scanner/componentScanner.ts`, then expose it through Doctor, CLI, and dashboard.
- Add an artifact recipe that returns `GeneratedArtifact`; include it in `buildGenerationPlan`.
- Change a template only with a golden generation test. The registry digest makes template-set drift visible.

## State

- `.component-library.json`: committed desired configuration
- `.aem-catalog-policy.json`: committed organization policy
- `.aem-catalog-manifest.json`: portable ownership state; recommended to commit
- `.aem-catalog/`: ignored local backups and audit history
