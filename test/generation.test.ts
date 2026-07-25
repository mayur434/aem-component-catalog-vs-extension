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
    expect(initial.items).toHaveLength(15);
    expect(initial.items.every((item) => item.status === 'create')).toBe(true);

    const firstResult = applyGenerationPlan(initial, { actor: 'test' });
    expect(firstResult.created).toBe(15);
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
    expect(repoinit.relativePath).toContain('config.author');
    // DAM-managed images: servlet reads /content/dam/<app>/catalog, RepoInit provisions it.
    expect(
      parsed.scripts.some((script) => script.includes('create path (sling:OrderedFolder) /content/dam/sample-site/catalog')),
    ).toBe(true);
    expect(
      parsed.scripts.some((script) => script.includes('allow jcr:read on /content/dam/sample-site/catalog')),
    ).toBe(true);
    // Component usage: nightly Sling job + service, servlet reads it, RepoInit grants /content read.
    expect(
      parsed.scripts.some((script) => script.includes('allow jcr:read on /content')),
    ).toBe(true);
    // Oak index via RepoInit (not a ui.content package): the usage crawl's
    // "sling:resourceType LIKE '%/components/%'" query would otherwise fall back to a full
    // unindexed repository traversal on every rebuild (confirmed live via Oak's own
    // "Traversal query (query without index)... consider creating an index" log line).
    // RepoInit runs with a privileged session and writes directly to the repository, so this
    // needs neither ui.content nor any FileVault packaging opt-in.
    // oak:QueryIndexDefinition has a mandatory "type" property, so a plain "create path" then
    // a separate "set properties on" statement fails: RepoInit saves the bare node first,
    // violating the constraint before the second statement ever runs (confirmed live via
    // OakConstraint0021 "Mandatory properties '[type]' not found"). The "with properties"
    // form (SLING-10740) sets it atomically as part of node creation.
    expect(
      parsed.scripts.some((script) =>
        script.includes(
          'create path (oak:QueryIndexDefinition) /oak:index/sample-site-component-usage-resourcetype-1 with properties',
        ),
      ),
    ).toBe(true);
    expect(
      parsed.scripts.some(
        (script) =>
          script.includes('/oak:index/sample-site-component-usage-resourcetype-1') &&
          script.includes('set type{String} to "lucene"') &&
          script.includes('set evaluatePathRestrictions{Boolean} to true') &&
          script.includes('set includedPaths{String} to /content'),
      ),
    ).toBe(true);
    expect(
      parsed.scripts.some(
        (script) =>
          script.includes('indexRules/nt:base/properties/slingResourceType') &&
          script.includes('set name{String} to "sling:resourceType"') &&
          script.includes('set analyzed{Boolean} to true') &&
          script.includes('set propertyIndex{Boolean} to true'),
      ),
    ).toBe(true);
    const usageService = plan.items.find((item) => item.relativePath.endsWith('ComponentUsageService.java'))!.content;
    expect(usageService).toContain('scheduler.expression=0 0 2 * * ?');
    expect(usageService).toContain('implements Runnable');
    // Sites use project proxies; usage must follow one level of sling:resourceSuperType.
    expect(usageService).toContain('sling:resourceSuperType');
    expect(usageService).toContain('libraryRelFor');
    // Only published pages count as usage; drafts never replicated must not inflate counts.
    // Uses AEM's standard ReplicationStatus adaptable (not a raw cq:lastReplicationAction read),
    // which is correct on author or publish alike - no run-mode gating needed.
    expect(usageService).toContain('isPublished');
    expect(usageService).toContain('import com.day.cq.replication.ReplicationStatus;');
    expect(usageService).toContain('status.isActivated()');
    const servlet = plan.items.find((item) => item.relativePath.endsWith('ComponentLibraryServlet.java'))!.content;
    expect(servlet).toContain('getRunModes().contains("author")');
    expect(servlet).toContain('ResourceChangeListener');
    expect(servlet).toContain('ASSET_ROOT = "/content/dam/sample-site/catalog"');
    expect(servlet).toContain('damThumbnail');
    expect(servlet).toContain('usageService.pagesFor');
    // Hidden/container/structural components are excluded from the catalog by default.
    expect(servlet).toContain('isStructural');
    expect(servlet).toContain('EXCLUDED_LEAF_NAMES.add("container")');
    expect(servlet).toContain('wcm/components/container');
    // Discovery-first default: components with zero published usage still stay listed.
    expect(servlet).toContain('REQUIRE_PUBLISHED_USAGE = false');
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

  it('opts a project into hiding components with zero published usage', () => {
    fixture = createAemCloudFixture();
    const config = loadConfig(fixture.root);
    config.catalog.requirePublishedUsage = true;
    const plan = buildGenerationPlan(fixture.root, config);
    const servlet = plan.items.find((item) => item.relativePath.endsWith('ComponentLibraryServlet.java'))!
      .content;
    expect(servlet).toContain('REQUIRE_PUBLISHED_USAGE = true');
    expect(servlet).toContain('if (REQUIRE_PUBLISHED_USAGE && usages.isEmpty())');
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
