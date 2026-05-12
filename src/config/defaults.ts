/**
 * Sensible defaults for .component-library.json
 * Any field not specified by the user will use these values.
 */
import { ComponentLibraryConfig } from './schema';

export function getDefaults(appId: string): ComponentLibraryConfig {
  return {
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
    },
    output: {
      servletPackage: `com.${appId.replace(/-/g, '.')}.core.servlets`,
      clientlibCategory: `${appId}.componentlibrary`,
      contentPath: `/content/${appId}/component-library`,
      pageTitle: 'Component Library',
      pageResourceType: `${appId}/components/page/componentlibrary`,
    },
    serviceUser: {
      name: `${appId}-service`,
      subServiceName: 'component-library',
      bundleSymbolicName: `${appId}.core`,
    },
    hero: {
      badge: appId,
      titlePrefix: appId,
      titleHighlight: 'Component Library',
      description: `The unified component ecosystem — auto-discovered from the ${appId} codebase.`,
      stats: [
        { label: 'Version', value: 'v1.0' },
      ],
      footerText: `${appId} — Component Library · Auto-Discovered Design System`,
    },
  };
}
