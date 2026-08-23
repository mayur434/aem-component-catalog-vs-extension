---
sidebar_position: 4
---

# Generated Artifacts

This page documents every file **Generate** (and the `aem-catalog generate` CLI command) can write, where it lands in the reactor, and what it does at runtime. All paths are relative to the project root and use the config fields described in [Configuration & Governance](./configuration-and-governance). Every artifact is planned before it is written — see [Generation Safety & CI](./generation-safety-and-ci) for the `create`/`update`/`unchanged`/`conflict` classification and the atomic-write/rollback model that governs all of them.

`core`/`ui.apps` below also cover AEM AMS reactors using the alternate `bundle`/`content` module names — the same artifacts are generated in the equivalent module either way.

## Servlet & services (`core`/`bundle`)

Java source generated under `core/src/main/java/<servletPackage-as-path>/`, where `servletPackage` is `output.servletPackage` (default `com.<appId>.core.servlets`).

### `ComponentLibraryServlet.java`

The catalog's runtime HTTP endpoint (`GET`, resource type `output.pageResourceType`). On each request it:

- Walks `components.root` for components, applying the same group/leaf-name/supertype exclusions configured under `components.exclude`/`components.groups.exclude`.
- Resolves each component's thumbnail (`components.thumbnails.fileNames`, falling back to `thumbnails.fallbackIcon`), governance metadata (`governance.*Property` fields), and taxonomy (category from path, sub-category from `taxonomy.subCategoryProperty` or `componentGroup`).
- Serves paginated (`catalog.pageSize`), cached (`catalog.cacheSeconds`, private + `nosniff` headers) JSON, invalidated on Sling resource changes rather than on a fixed TTL alone.
- **Enforces author-only at runtime independently of deployment**: it checks the AEM `author` run mode itself and returns `404` on any other run mode — even if the containing package is accidentally deployed to Publish, the endpoint refuses to serve. This is a defense-in-depth check; `catalog.serveOnPublish` (see below) is the actual configuration switch for whether Publish should be reachable at all.
- When `catalog.serveOnPublish` is `true`, also responds on Publish (the Dispatcher allow rules described below become the access gate there instead).

### `ComponentUsageService.java`

A scheduled OSGi service (Sling Scheduler, cron `catalog.usageCron`, default nightly at 02:00) that crawls authored content under `/content/<appId>` for pages using each component, backing the "where is this used" data and (when `catalog.requirePublishedUsage` is `true`) the published-usage-only listing filter. Uses the Oak usage index described below to avoid a full repository traversal. Also runs the catalog-JSON generator on `catalog.generatorCron` (default 02:30, after the usage crawl), writing the static catalog JSON to `output.assetRoot`-adjacent DAM content.

### `SiteDomainService.java`

**Only generated when `taxonomy.siteDomains` has at least one entry** — this is an opt-in feature; an empty list means no Java class, no OSGi config, and no `@Reference` wiring for it appear anywhere in the generated output. When present, it's an `@Designate`-configured OSGi component that resolves a category (site) to its public domain, used by `ComponentUsageService` to turn raw JCR "where used" paths into absolute, clickable URLs. Its annotation defaults are always blank placeholders (`<category>=`); the real domain values live only in the generated per-run-mode OSGi config (below), never hardcoded into Java.

## Page component & clientlib (`ui.apps`/`content`)

Under `ui.apps/src/main/content/jcr_root/apps/<appId>/`.

### Page component — `components/page/componentlibrary/`

| File | Purpose |
| --- | --- |
| `.content.xml` | `cq:Component` definition — `jcr:title` from `output.pageTitle`, extends `output.pageSuperType` (default the WCM core page, so the catalog renders even without a project-specific base page) |
| `body.html` | HTL markup rendering the hero section (`hero.*`) and the feature-gated UI blocks (`features.*`) |
| `customheaderlibs.html` / `customfooterlibs.html` | Include the generated clientlib (`output.clientlibCategory`) in the page `<head>`/before `</body>` |

### Clientlib — `clientlibs/clientlib-componentlibrary/`

A standard `cq:ClientLibraryFolder` (`allowProxy=true`, category `output.clientlibCategory`):

| File | Purpose |
| --- | --- |
| `.content.xml` | Clientlib folder definition |
| `js.txt` / `css.txt` | `#base` + file manifests |
| `js/scripts.js` | Client-side catalog logic — search, filters, lightbox, sort, dependency graph rendering — driven by `features.*`, `components.*`, `hero.*`, and `catalog.*` |
| `css/styles.css` | Catalog styling, themed from `brand.*` and gated by `features.*` |

### Oak index — `_oak_index/<usageIndexName>/.content.xml`

A Lucene property index backing `ComponentUsageService`'s nightly `sling:resourceType LIKE '%/components/%'` crawl, which Oak cannot serve efficiently from an ordinary index. Named `catalog.usageIndexName` (default `<oakIndexPrefix>.componentUsage-custom-1`, where the prefix is a 2–5 character vendor tag derived from `appId`) to satisfy AEMaaCS's requirement that every custom index use a `<prefix>.<name>-custom-<version>` name, avoiding collisions with Adobe's own product indexes.

Deployed as part of `ui.apps` (a **code** package) rather than via RepoInit or `ui.content`: AEMaaCS installs and reindexes `/oak:index` definitions before the blue-green switchover, which only happens for index definitions delivered as code — a RepoInit- or content-created index would never get that managed reindex. FileVault's platform-name mangling is why the JCR name `oak:index` becomes the folder `_oak_index` on disk.

## OSGi configuration (`ui.config`)

Under `ui.config/src/main/content/jcr_root/apps/<appId>/osgiconfig/config/` (applies to both Author and Publish run modes — not `config.author` only; see below for why).

### `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended~<appId>-componentlibrary.cfg.json`

Maps `serviceUser.bundleSymbolicName`:`serviceUser.subServiceName` to the service user `serviceUser.name` (default `<appId>-componentlibrary-service`), so the generated Java code can obtain a `ResourceResolver` scoped to that user rather than running as an admin session.

### `org.apache.sling.jcr.repoinit.RepositoryInitializer~<appId>-componentlibrary.cfg.json`

RepoInit script that creates the service user and grants it narrow, read-mostly ACLs on `components.root`, `output.contentPath` (the generated catalog page and its ancestors), and `output.assetRoot` (DAM images) — nothing broader.

:::info Why the `-componentlibrary` suffix, not the bare `appId`
The standard AEM Project Archetype already scaffolds its **own** default `~<appId>` service-user-mapper and RepoInit files, and its own `<appId>-service` service user, for every new reactor. Reusing that bare suffix/name would put the catalog's generated file on the *exact same path* as that pre-existing, unrelated archetype file. The generation planner treats a pre-existing file with different content as a `conflict` and — being conservative by design — refuses to overwrite it, so the catalog's RepoInit/service-user config would silently never actually get written, even though the plan reports no error. The `-componentlibrary` suffix (and the distinct `-componentlibrary-service` user name) keeps the catalog's config in its own file/identity, always additive and never colliding with the archetype's own defaults.
:::

Both files apply to **every run mode**, deliberately not just `config.author`: the `core`/`bundle` bundle itself deploys to both Author and Publish by default (nothing tier-restricts the package), and without the service-user mapping present on Publish too, the bundle would still activate there but fail every night with a `LoginException` when `ComponentUsageService` runs. The catalog UI itself still only responds on Author (or Author+Publish if `catalog.serveOnPublish` is set) — that's a **runtime** check inside the servlet, unrelated to which OSGi config folder these files live in.

### `<servletPackage>.SiteDomainService.cfg.json` (opt-in)

Generated only alongside `SiteDomainService.java` (i.e. only when `taxonomy.siteDomains` is non-empty), as **two separate files** — one per run mode, since stage and prod domains genuinely differ:

- `ui.config/.../osgiconfig/config.prod/<servletPackage>.SiteDomainService.cfg.json` — populated with each category's `prodDomain`
- `ui.config/.../osgiconfig/config.stage/<servletPackage>.SiteDomainService.cfg.json` — populated with each category's `stageDomain`

Both also carry each category's `shortenPath`, which is the same value in both files since a site's Dispatcher rewrite behavior doesn't differ between stage and prod. Unlike the two configs above, this is a normal `@Designate`-based singleton PID (the fully-qualified `SiteDomainService` class name) — not a Sling factory config, so it has no `~<suffix>`.

## Dispatcher allow rules (project root)

`component-catalog-dispatcher-filters.any` — **only generated when `catalog.serveOnPublish` is `true`**; skipped entirely otherwise, since an author-only catalog is never reached by Dispatcher at all.

Written as a single loose file at the **project root**, deliberately *not* into a `dispatcher/src/conf.dispatcher.d/...` tree: a catalog project usually does not own the actual Dispatcher configuration (Cloud Manager only applies Dispatcher config from the repository its own pipeline builds), and generating the conventional folder layout here would produce something that looks like a real Dispatcher module but has no `pom.xml` and belongs to no reactor, so nothing would ever build or deploy it. The standalone, clearly-named file makes clear this is a portable snippet to copy into whichever repository does own Dispatcher configuration for the project.

## What is never generated

- **`ui.content`** is never written to by generation (only read, for usage scanning) — content packages remain entirely author-owned.
- **Dispatcher config** is only ever the single opt-in `.any` snippet above; the tool never touches an actual `dispatcher`/`dispatcher.cloud` module.
- Any artifact whose target path already has different content on disk and isn't recorded as owned in `.aem-catalog-manifest.json` is left untouched (`conflict` status) rather than overwritten — see [Generation Safety & CI](./generation-safety-and-ci).

Next: [Generation Safety & CI](./generation-safety-and-ci).
