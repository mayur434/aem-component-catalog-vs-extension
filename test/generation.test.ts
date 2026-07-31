import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/loader';
import { applyGenerationPlan, buildGenerationPlan, rollbackLastGeneration } from '../src/core/generation';
import { createAemCloudFixture, type AemFixture } from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

describe('transactional generation', () => {
  it('plans, applies, becomes idempotent, preserves conflicts, and rolls back', () => {
    fixture = createAemCloudFixture();
    const config = loadConfig(fixture.root);
    const initial = buildGenerationPlan(fixture.root, config);
    expect(initial.items).toHaveLength(17);
    expect(initial.items.every((item) => item.status === 'create')).toBe(true);

    const firstResult = applyGenerationPlan(initial, { actor: 'test' });
    expect(firstResult.created).toBe(17);
    expect(firstResult.skipped).toBe(0);
    expect(fs.existsSync(path.join(fixture.root, '.aem-catalog-manifest.json'))).toBe(true);

    const stable = buildGenerationPlan(fixture.root, config);
    expect(stable.items.every((item) => item.status === 'unchanged')).toBe(true);

    const servlet = stable.items.find((item) => item.relativePath.endsWith('ComponentLibraryServlet.java'))!;
    fs.appendFileSync(servlet.absolutePath, '\n// manual enterprise customization\n');
    const conflict = buildGenerationPlan(fixture.root, config);
    expect(conflict.items.find((item) => item.relativePath === servlet.relativePath)?.status).toBe(
      'conflict',
    );
    const safe = applyGenerationPlan(conflict, { actor: 'test' });
    expect(safe.skipped).toBe(1);
    expect(fs.readFileSync(servlet.absolutePath, 'utf-8')).toContain('manual enterprise customization');

    const forced = applyGenerationPlan(conflict, { actor: 'test', overwriteConflicts: true });
    expect(forced.updated).toBe(1);
    expect(fs.readFileSync(servlet.absolutePath, 'utf-8')).not.toContain('manual enterprise customization');
    const transaction = rollbackLastGeneration(fixture.root, 'test');
    expect(transaction).toBe(forced.transactionId);
    expect(fs.readFileSync(servlet.absolutePath, 'utf-8')).toContain('manual enterprise customization');
  });

  it('renders author-only, valid OSGi JSON and hardened frontend output', () => {
    fixture = createAemCloudFixture();
    const plan = buildGenerationPlan(fixture.root, loadConfig(fixture.root));
    const repoinit = plan.items.find((item) => item.relativePath.includes('RepositoryInitializer'))!;
    const parsed = JSON.parse(repoinit.content) as { scripts: string[] };
    expect(
      parsed.scripts.some((script) => script.includes('forced path system/cq:services/sample-site')),
    ).toBe(true);
    // The service user reads all of /apps: the servlet needs the library components node, and
    // the usage job must resolve each site proxy's sling:resourceSuperType under /apps/<site>.
    expect(
      parsed.scripts.some((script) => /allow jcr:read on \/apps\b(?!\/)/.test(script)),
    ).toBe(true);
    // PRINCIPAL-based ACL, never a resource ACL. A resource ACL persists a rep:policy node
    // UNDER the target, i.e. under the immutable /apps - and RepoInit runs twice on AEMaaCS
    // (buildImage, then again at container startup when /apps is read-only). The second run
    // then hits a read-only builder, SlingRepository never registers, and the pod fails to
    // start. A principal ACL stores rep:principalPolicy under the service user's own home
    // (mutable) and only references /apps as an effective path, so it never writes there.
    expect(parsed.scripts.some((script) => script.startsWith('set principal ACL for'))).toBe(true);
    expect(parsed.scripts.some((script) => /^set ACL for/m.test(script))).toBe(false);
    // Under the plain config/ folder (all run modes), not config.author-only: the core
    // bundle deploys to every tier by default, and the service-user mapping/usage-crawl
    // job have no run-mode guard of their own - config.author-only would leave them
    // failing (LoginException) every night on publish. The catalog UI itself still stays
    // author-only via the servlet's own runtime check, independent of this.
    expect(repoinit.relativePath.split('/')).toContain('config');
    expect(repoinit.relativePath).not.toContain('config.author');
    expect(repoinit.relativePath).not.toContain('config.publish');
    // DAM-managed images: servlet reads /content/dam/<app>/catalog, RepoInit provisions it.
    expect(
      parsed.scripts.some((script) => script.includes('create path (sling:OrderedFolder) /content/dam/sample-site/catalog')),
    ).toBe(true);
    // CatalogGeneratorService writes static JSON to DAM — rep:write + jcr:versionManagement.
    expect(
      parsed.scripts.some((script) => script.includes('allow jcr:read,rep:write,jcr:versionManagement on /content/dam/sample-site/catalog')),
    ).toBe(true);
    // Fallback write path for catalog JSON under /content/<appId>.
    expect(
      parsed.scripts.some((script) => script.includes('allow jcr:read,rep:write on /content/sample-site')),
    ).toBe(true);
    // Component usage: nightly Sling job + service, servlet reads it, RepoInit grants /content read.
    expect(
      parsed.scripts.some((script) => script.includes('allow jcr:read on /content')),
    ).toBe(true);
    // The Oak index must NOT be created by RepoInit. AEMaaCS installs and reindexes
    // /oak:index definitions before the blue-green switchover, and only for definitions that
    // arrive as code in ui.apps; RepoInit runs later, at bundle startup, so a RepoInit-created
    // index never gets that managed reindex and silently returns nothing.
    expect(parsed.scripts.some((script) => script.includes('/oak:index'))).toBe(false);

    // It ships in ui.apps (the CODE package) instead, at the FileVault-mangled _oak_index
    // path, with an AEMaaCS-compliant node name: <prefix>.<indexName>-custom-<version>.
    const oakIndex = plan.items.find((item) => item.relativePath.includes('_oak_index'))!;
    expect(oakIndex.relativePath.startsWith('ui.apps/')).toBe(true);
    expect(oakIndex.relativePath).toContain('_oak_index/sam.componentUsage-custom-1/.content.xml');
    expect(oakIndex.content).toContain('jcr:primaryType="oak:QueryIndexDefinition"');
    expect(oakIndex.content).toContain('type="lucene"');
    expect(oakIndex.content).toContain('includedPaths="[/content]"');
    expect(oakIndex.content).toContain('name="sling:resourceType"');
    expect(oakIndex.content).toContain('analyzed="{Boolean}true"');
    const usageService = plan.items.find((item) => item.relativePath.endsWith('ComponentUsageService.java'))!.content;
    expect(usageService).toContain('scheduler.expression=0 0 2 * * ?');
    expect(usageService).toContain('implements Runnable');
    // Sites use project proxies; usage must follow one level of sling:resourceSuperType.
    expect(usageService).toContain('sling:resourceSuperType');
    expect(usageService).toContain('libraryRelFor');
    // "Live" is evaluated PER TIER. Replication-status properties are written on author at
    // activation and are not reliably carried onto the replicated copy, so applying that check
    // on publish would report zero usages for everything. On publish, presence in the
    // repository IS the published state - hence the run-mode branch before the status check.
    expect(usageService).toContain('isPublished');
    expect(usageService).toContain('import com.day.cq.replication.ReplicationStatus;');
    expect(usageService).toContain('import org.apache.sling.settings.SlingSettingsService;');
    expect(usageService).toContain('if (!slingSettings.getRunModes().contains("author"))');
    expect(usageService).toContain('status.isActivated()');
    const servlet = plan.items.find((item) => item.relativePath.endsWith('ComponentLibraryServlet.java'))!.content;
    expect(servlet).toContain('runModes.contains("author")');
    expect(servlet).toContain('ResourceChangeListener');
    expect(servlet).toContain('ASSET_ROOT = "/content/dam/sample-site/catalog"');
    expect(servlet).toContain('damThumbnail');
    expect(servlet).toContain('usageService.pagesFor');
    // Static catalog JSON: servlet reads pre-built JSON from DAM/content before /apps traversal.
    expect(servlet).toContain('STATIC_CATALOG_DAM_PATH');
    expect(servlet).toContain('STATIC_CATALOG_CONTENT_PATH');
    expect(servlet).toContain('loadStaticCatalog');
    expect(servlet).toContain('loadFromDam');
    expect(servlet).toContain('loadFromContent');
    expect(servlet).toContain('parseCatalogJson');
    expect(servlet).toContain('import com.google.gson.JsonParser');
    // CatalogGeneratorService: builds static JSON on activate + daily schedule.
    const generator = plan.items.find((item) => item.relativePath.endsWith('CatalogGeneratorService.java'))!.content;
    expect(generator).toContain('scheduler.expression=0 30 2 * * ?');
    expect(generator).toContain('STARTUP_DELAY_MS = 10L * 60L * 1000L');
    expect(generator).toContain('writeJsonToDam');
    expect(generator).toContain('writeJsonToContent');
    expect(generator).toContain('STATIC_CATALOG_DAM_PATH = "/content/dam/sample-site/catalog/components-catalog.json"');
    expect(generator).toContain('STATIC_CATALOG_CONTENT_PATH = "/content/sample-site/catalog-data"');
    expect(generator).toContain('scheduler.AT(fireAt)');
    // Fail-silent: INFO logs, not ERROR, to avoid false alerts on ACL issues.
    expect(generator).not.toContain('LOG.error');
    expect(generator).toContain('LOG.info("[CatalogGenerator]');
    // Hidden/container/structural components are excluded from the catalog by default.
    expect(servlet).toContain('isStructural');
    expect(servlet).toContain('EXCLUDED_LEAF_NAMES.add("container")');
    expect(servlet).toContain('wcm/components/container');
    // Discovery-first default: components with zero published usage still stay listed.
    expect(servlet).toContain('REQUIRE_PUBLISHED_USAGE = false');
    // Author-only by default (the catalog exposes internal component structure and the page
    // paths using each component), but the gate is a flag rather than a hardcoded run mode.
    expect(servlet).toContain('SERVE_ON_PUBLISH = false');
    expect(servlet).toContain('private boolean isEnabledRunMode()');
    expect(servlet).not.toContain('if (!slingSettings.getRunModes().contains("author")) {');
    const script = plan.items.find((item) => item.relativePath.endsWith('scripts.js'))!.content;
    expect(script).toContain('var h = esc(md)');
    expect(script).toContain('fetchAll(endpoint)');
    // Richer output: faceted filters, quality metrics strip, and detail relationships.
    expect(script).toContain('renderFacets');
    expect(script).toContain('renderMetrics');
    expect(script).toContain('relationshipsSection');
    expect(script).toContain('carouselSection');
    expect(script).toContain('bindCarousel');
    // "Where it's used" opens a scrollable, filterable modal rather than an inline list.
    expect(script).toContain('bindUsageModal');
    expect(script).toContain('renderUsageRows');
    // Badge/sub-category labels strip the "<App Id> - " prefix at runtime (was a broken,
    // template-embedded regex that never matched and left raw group text un-stripped).
    expect(script).toContain('APP_PREFIX_RE');
    expect(script).toContain('new RegExp("^" + escaped');
    // Cross-site reuse count and a derived (non-boilerplate) fallback description.
    expect(script).toContain('computeReuseCounts');
    expect(script).toContain('fallbackDescription');
    expect(script).toContain('humanizeSegment');
    // Sort control: default usage high->low, re-orders listing without duplicate listeners.
    expect(script).toContain('getSortMode');
    expect(script).toContain('renderSections');
    expect(script).toContain('bindSort');
    const body = plan.items.find((item) =>
      item.relativePath.endsWith('page/componentlibrary/body.html'),
    )!.content;
    expect(body).toContain('id="pcl-sort"');
    expect(body).toContain('<option value="usage" selected>');
    expect(body).toContain('id="pcl-usage-modal"');
    const styles = plan.items.find((item) => item.relativePath.endsWith('styles.css'))!.content;
    expect(styles).toContain('.pcl-facet__select');
    expect(styles).toContain('.pcl-metric');
    expect(styles).toContain('.pcl-sort__select');
    expect(styles).toContain('.pcl-usage-modal__panel');
    // Badge color-coding was dead code: an [class*=] fallback selector had higher specificity
    // than .pcl-card__badge--content/--commerce/etc, so every badge rendered identically.
    expect(styles).not.toContain('[class*="pcl-card__badge--"]');
    expect(styles).toContain('.pcl-reuse');
    expect(styles).toContain('flex-wrap: wrap');
    // The catalog page must extend the WCM core page so it renders in any project.
    const pageDef = plan.items.find((item) =>
      item.relativePath.endsWith('page/componentlibrary/.content.xml'),
    )!.content;
    expect(pageDef).toContain('sling:resourceSuperType="core/wcm/components/page/v3/page"');
    expect(pageDef).not.toContain('sample-site/components/page"');
  });

  it('generates dispatcher allow rules only when the catalog serves on publish', () => {
    fixture = createAemCloudFixture();
    const config = loadConfig(fixture.root);

    // Author-only (the default): the dispatcher never sees these requests, so no file.
    expect(config.catalog.serveOnPublish).toBe(false);
    const authorOnly = buildGenerationPlan(fixture.root, config);
    expect(authorOnly.items.some((item) => item.relativePath.endsWith('.any'))).toBe(false);

    config.catalog.serveOnPublish = true;
    const onPublish = buildGenerationPlan(fixture.root, config);
    const servlet = onPublish.items.find((item) =>
      item.relativePath.endsWith('ComponentLibraryServlet.java'),
    )!.content;
    expect(servlet).toContain('SERVE_ON_PUBLISH = true');

    const filters = onPublish.items.find((item) => item.relativePath.endsWith('.any'))!;
    // A single loose file at the project root, NOT a dispatcher/src/conf.dispatcher.d tree.
    // Generating that folder layout here would look like a dispatcher module while having
    // no pom.xml and being in no reactor, so nothing would ever build or deploy it.
    expect(filters.relativePath).toBe('component-catalog-dispatcher-filters.any');
    expect(filters.content).toContain('THIS FILE IS NOT DEPLOYED BY THIS PROJECT');
    // The default AEMaaCS filter set denies by default, so every route the micro-site
    // actually uses needs an explicit allow - including the two that are easy to miss:
    // the .html/<component> SUFFIX used by detail views, and the selector-pinned
    // components.json data endpoint (without which the page renders but lists nothing).
    expect(filters.content).toContain('/suffix "*"');
    expect(filters.content).toContain('/selectors "components"');
    expect(filters.content).toContain('/extension "json"');
    expect(filters.content).toContain('/content/sample-site/component-library');
    expect(filters.content).toContain('/etc.clientlibs/sample-site/clientlibs/*');
    expect(filters.content).toContain('/content/dam/sample-site/catalog/*');
    // Pinning the selector matters: a bare .json allow would open arbitrary traversal of
    // the content tree through Sling's default GET servlet. Assert it per rule block, so
    // every rule that permits json also constrains the selector.
    const jsonRules = filters.content
      .split(/\n(?=\/\d+\s*\{)/)
      .filter((rule) => /\/extension\s+"json"/.test(rule));
    expect(jsonRules.length).toBeGreaterThan(0);
    for (const rule of jsonRules) {
      expect(rule).toMatch(/\/selectors\s+"components"/);
    }
  });

  it('opts a project into hiding components with zero published usage', () => {
    fixture = createAemCloudFixture();
    const config = loadConfig(fixture.root);
    config.catalog.requirePublishedUsage = true;
    const plan = buildGenerationPlan(fixture.root, config);
    const servlet = plan.items.find((item) => item.relativePath.endsWith('ComponentLibraryServlet.java'))!
      .content;
    expect(servlet).toContain('REQUIRE_PUBLISHED_USAGE = true');
    // Fails OPEN: the filter only applies on an instance that actually has usage data.
    // A cold start, a failed crawl, or - most commonly - an environment where nothing is
    // live yet all produce an empty index, and hiding every component in those cases
    // yields a blank catalog rather than an unfiltered one.
    expect(servlet).toContain(
      'if (REQUIRE_PUBLISHED_USAGE && usages.isEmpty() && usageService.hasUsageData())',
    );
    const usage = plan.items.find((item) => item.relativePath.endsWith('ComponentUsageService.java'))!
      .content;
    expect(usage).toContain('public boolean hasUsageData()');
    expect(usage).toContain('return !usageByComponent.isEmpty();');
  });

  it('adds the missing clientlib filter root so the package still builds', () => {
    fixture = createAemCloudFixture();
    const filterFile = path.join(fixture.root, 'ui.apps/src/main/content/META-INF/vault/filter.xml');
    // Narrow the filter to components only — the generated clientlib would be uncovered.
    fs.writeFileSync(
      filterFile,
      '<?xml version="1.0" encoding="UTF-8"?>\n<workspaceFilter version="1.0">\n    <filter root="/apps/sample-site/components"/>\n</workspaceFilter>\n',
    );
    applyGenerationPlan(buildGenerationPlan(fixture.root, loadConfig(fixture.root)), { actor: 'test' });
    const filter = fs.readFileSync(filterFile, 'utf-8');
    // Root is a direct child of /apps/<appId> (validator-safe for application packages).
    expect(filter).toContain('<filter root="/apps/sample-site/clientlibs"/>');
    // Not the deeper path (its ancestor would be undefined), nor a duplicate page-component rule.
    expect(filter).not.toContain('/apps/sample-site/clientlibs/clientlib-componentlibrary');
    expect(filter).not.toContain('/apps/sample-site/components/page/componentlibrary');
  });

  it('never emits an XML element/attribute prefix without a matching xmlns declaration', () => {
    // Caught a real bug during development: the Oak index template used <nt:base> without
    // declaring xmlns:nt, which parses as "well-formed enough" by lenient tools but is
    // rejected as an unbound-prefix error by a real (namespace-aware) XML parser - exactly
    // the class of error FileVault would hit on package install.
    fixture = createAemCloudFixture();
    const plan = buildGenerationPlan(fixture.root, loadConfig(fixture.root));
    for (const item of plan.items.filter((entry) => entry.relativePath.endsWith('.xml'))) {
      const declared = new Set(
        [...item.content.matchAll(/xmlns:([a-zA-Z0-9_-]+)=/g)].map((match) => match[1]),
      );
      const used = new Set(
        [...item.content.matchAll(/<\/?([a-zA-Z0-9_-]+):[a-zA-Z0-9_-]+[\s/>]/g)].map((match) => match[1]),
      );
      for (const prefix of used) {
        expect(declared, `${item.relativePath} uses "${prefix}:" without declaring xmlns:${prefix}`).toContain(
          prefix,
        );
      }
    }
  });

});
