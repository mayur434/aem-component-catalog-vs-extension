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
}

export interface OutputConfig {
  servletPackage: string;
  clientlibCategory: string;
  contentPath: string;
  pageTitle: string;
  pageResourceType: string;
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

export interface ComponentLibraryConfig {
  appId: string;
  brand: BrandConfig;
  components: ComponentsConfig;
  features: FeaturesConfig;
  output: OutputConfig;
  serviceUser: ServiceUserConfig;
  hero: HeroConfig;
  /** Detected AEM project type — 'cloud' (AEMaaCS) or 'ams' (AEM 6.x). Auto-detected, user can override. */
  projectType?: 'cloud' | 'ams';
}
