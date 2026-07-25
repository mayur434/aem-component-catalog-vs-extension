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
