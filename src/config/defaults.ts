/**
 * Sensible defaults for .component-library.json
 * Any field not specified by the user will use these values.
 */
import type { ComponentLibraryConfig } from './schema';

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
      qualityScore: true,
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
    },
    governance: {
      policyFile: '.aem-catalog-policy.json',
      ownerProperty: 'catalogOwner',
      statusProperty: 'catalogStatus',
      versionProperty: 'catalogVersion',
      tagsProperty: 'catalogTags',
    },
    // Category = website folder (first segment under components root); Sub Category =
    // catalogSubCategory property when present, else the AEM componentGroup.
    taxonomy: {
      categoryLabels: {
        campaign: 'Haisha Paints Campaigns',
        corporate: 'Corporate',
        haishapaints: 'Haisha Paints',
        industrialproducts: 'Industrial Products',
        pigments: 'Pigments',
      },
      subCategoryProperty: 'catalogSubCategory',
    },
  };
}
