/**
 * Sensible defaults for .component-library.json
 * Any field not specified by the user will use these values.
 */
import type { ComponentLibraryConfig } from './schema';

/**
 * AEMaaCS requires every fully-custom Oak index to be named
 * `<prefix>.<indexName>-custom-<version>`, where the prefix is a 2-5 character vendor
 * identifier that prevents collisions with Adobe's own product indexes. Derived from the
 * appId's first segment so it is stable and recognisable per project.
 */
export function oakIndexPrefix(appId: string): string {
  const letters = (appId.split('-')[0] || appId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return (letters.slice(0, 3) || 'cat').padEnd(2, 'x');
}

export function getDefaults(appId: string): ComponentLibraryConfig {
  return {
    schemaVersion: 2,
    appId,
    brand: {
      primary: '#03438E',
      primaryLight: '#024997',
      primaryDark: '#002D62',
      primaryDeeper: '#001B3D',
      accent: '#4CADE9',
      accentHover: '#3A9AD6',
      gold: '#FFD700',
      sky: '#00ABE8',
      background: '#F4F7FB',
      font: 'articulat-cf',
      fontFallback: 'Roboto, sans-serif',
    },
    components: {
      root: `/apps/${appId}/components`,
      groups: {
        exclude: ['.hidden'],
        labels: {},
      },
      exclude: {
        leafNames: ['container', 'responsivegrid', 'parsys', 'page', 'xfpage', 'structure', 'root'],
        superTypeTokens: [
          'wcm/components/container',
          'wcm/foundation/components/parsys',
          'wcm/foundation/components/responsivegrid',
          'wcm/components/page',
          'wcm/foundation/components/page',
        ],
      },
      thumbnails: {
        fileNames: ['thumbnail.png', 'thumbnail.svg', 'thumbnail.jpg'],
        fallbackIcon: 'grid',
      },
      layouts: {
        folderName: 'layouts',
        exclude: ['thumbnail.*'],
      },
    },
    features: {
      search: true,
      groupFilters: true,
      lightbox: true,
      codeSnippets: true,
      readme: true,
      darkMode: false,
      // Governance view (quality metrics strip + Status/Owner/Quality facets). Off by
      // default: the catalog is a designer/business-facing showcase, not a scorecard.
      // Toggle "Quality metrics" on in the config panel for the governance view.
      qualityScore: false,
      dependencyGraph: true,
      accessibility: true,
    },
    output: {
      servletPackage: `com.${appId.replace(/-/g, '.')}.core.servlets`,
      clientlibCategory: `${appId}.componentlibrary`,
      contentPath: `/content/${appId}/component-library`,
      pageTitle: 'Component Catalog',
      pageResourceType: `${appId}/components/page/componentlibrary`,
      // Extend the WCM core page (always present on AEMaaCS) so the catalog renders
      // even in a component library that has no base page component of its own.
      pageSuperType: 'core/wcm/components/page/v3/page',
      // Component images live in the DAM (author-managed, no deploy). Per component:
      // <assetRoot>/<component-relative-path>/thumbnail.<ext> and other images.
      assetRoot: `/content/dam/${appId}/catalog`,
    },
    serviceUser: {
      name: `${appId}-service`,
      subServiceName: 'component-library',
      bundleSymbolicName: `${appId}.core`,
    },
    hero: {
      badge: appId,
      titlePrefix: appId,
      titleHighlight: 'Component Catalog',
      description: `The unified component ecosystem — auto-discovered from the ${appId} codebase.`,
      stats: [{ label: 'Version', value: 'v1.0' }],
      footerText: `${appId} — Enterprise Component Catalog · Auto-Discovered Design System`,
    },
    catalog: {
      deploymentTarget: 'author',
      cacheSeconds: 60,
      pageSize: 250,
      // Nightly at 02:00 — rebuild the in-memory "which pages use this component" index.
      usageCron: '0 0 2 * * ?',
      // A component library's core purpose is discovery, so components stay visible even
      // before anyone has used them yet — the catalog would otherwise hide its own newest
      // additions until someone happens to publish a page with them. Projects that want a
      // stricter "only what's live" view can opt in per project.
      requirePublishedUsage: false,
      // AEMaaCS-mandated custom index name: <prefix>.<indexName>-custom-<version>.
      // Bump the trailing number (never edit in place) whenever the definition changes —
      // AEMaaCS treats each -custom-N node as a distinct, immutable index revision.
      usageIndexName: `${oakIndexPrefix(appId)}.componentUsage-custom-1`,
      // Author-only by default: the catalog exposes internal component structure and the
      // page paths using each component, which is not information a public tier should
      // serve unless the project has deliberately decided otherwise.
      serveOnPublish: false,
    },
    governance: {
      policyFile: '.aem-catalog-policy.json',
      ownerProperty: 'catalogOwner',
      statusProperty: 'catalogStatus',
      versionProperty: 'catalogVersion',
      tagsProperty: 'catalogTags',
    },
    // Category = website folder (first segment under components root); Sub Category =
    // catalogSubCategory property when present, else the AEM componentGroup. No curated
    // labels by default — an uncurated category key is auto-prettified (e.g. "mysite" ->
    // "Mysite") by the servlet's prettifyCategory fallback. Projects with multiple brand
    // folders can add their own mappings here (or per-project in .component-library.json)
    // for nicer display names.
    taxonomy: {
      categoryLabels: {},
      subCategoryProperty: 'catalogSubCategory',
    },
  };
}
