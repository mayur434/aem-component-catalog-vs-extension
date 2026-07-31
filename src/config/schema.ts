/**
 * Configuration schema — TypeScript interfaces for .component-library.json
 */

export interface BrandConfig {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  primaryDeeper: string;
  accent: string;
  accentHover: string;
  gold: string;
  sky: string;
  background: string;
  font: string;
  fontFallback: string;
}

export interface ComponentsConfig {
  root: string;
  groups: {
    exclude: string[];
    labels: Record<string, string>;
  };
  /**
   * Components hidden from the catalog by default: structural/layout building blocks that
   * every page uses (containers, parsys/grid, page/structure) add no value in a showcase.
   * A component is excluded when its leaf name is in `leafNames` OR its sling:resourceSuperType
   * contains one of `superTypeTokens`. (`.hidden` group components are already excluded.)
   */
  exclude: {
    leafNames: string[];
    superTypeTokens: string[];
  };
  thumbnails: {
    fileNames: string[];
    fallbackIcon: 'grid' | 'box' | 'layers' | string;
  };
  layouts: {
    folderName: string;
    exclude: string[];
  };
}

export interface FeaturesConfig {
  search: boolean;
  groupFilters: boolean;
  lightbox: boolean;
  codeSnippets: boolean;
  readme: boolean;
  darkMode: boolean;
  qualityScore: boolean;
  dependencyGraph: boolean;
  accessibility: boolean;
}

export interface OutputConfig {
  servletPackage: string;
  clientlibCategory: string;
  contentPath: string;
  pageTitle: string;
  pageResourceType: string;
  /** The page component the catalog page extends; defaults to the WCM core page. */
  pageSuperType: string;
  /** DAM folder authors manage component images in (thumbnail + gallery), no deploy. */
  assetRoot: string;
}

export interface ServiceUserConfig {
  name: string;
  subServiceName: string;
  bundleSymbolicName: string;
}

export interface HeroConfig {
  badge: string;
  titlePrefix: string;
  titleHighlight: string;
  description: string;
  stats: Array<{ label: string; value: string }>;
  footerText: string;
}

export interface CatalogRuntimeConfig {
  /** Enterprise catalogs are provisioned on Author only. */
  deploymentTarget: 'author';
  cacheSeconds: number;
  pageSize: number;
  /** Quartz cron for the nightly component-usage index rebuild (Sling scheduler). */
  usageCron: string;
  /** Quartz cron for the catalog JSON generator (writes static JSON to DAM). */
  generatorCron: string;
  /**
   * When true, the catalog listing only includes components with at least one usage on a
   * currently-published page - a not-yet-adopted or draft-only component stays hidden until
   * some page using it is actually live. When false (the safer default for a component
   * library meant for discovery), every shipped component is listed regardless of usage.
   */
  requirePublishedUsage: boolean;
  /**
   * Name of the Oak Lucene index (under /oak:index) that keeps the nightly usage crawl's
   * sling:resourceType LIKE query off a full repository traversal. Bump the trailing number
   * (e.g. -1 -> -2) if the index definition changes, to force Oak to reindex.
   */
  usageIndexName: string;
  /**
   * Whether the catalog endpoint also responds on publish. It always responds on author.
   * Serving on publish makes component metadata (names, dialog fields) and the page paths
   * using each component reachable by anything that can reach the publish tier, so the
   * dispatcher filter is the real access gate there - this only decides whether the servlet
   * responds at all.
   */
  serveOnPublish: boolean;
}

export interface GovernanceConfig {
  policyFile: string;
  ownerProperty: string;
  statusProperty: string;
  versionProperty: string;
  tagsProperty: string;
}

/**
 * Two-level catalog taxonomy.
 * - Category  = the website (first path segment under the components root, e.g. `corporate`),
 *   shown using the friendly label from `categoryLabels` (falls back to a prettified key).
 * - Sub Category = the value of `subCategoryProperty` on the component when present,
 *   otherwise the component's AEM `componentGroup`.
 */
export interface TaxonomyConfig {
  categoryLabels: Record<string, string>;
  subCategoryProperty: string;
}

export interface ComponentLibraryConfig {
  schemaVersion: 2;
  appId: string;
  brand: BrandConfig;
  components: ComponentsConfig;
  features: FeaturesConfig;
  output: OutputConfig;
  serviceUser: ServiceUserConfig;
  hero: HeroConfig;
  catalog: CatalogRuntimeConfig;
  governance: GovernanceConfig;
  taxonomy: TaxonomyConfig;
}
