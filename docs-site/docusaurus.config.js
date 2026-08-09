// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'AEM Component Catalog',
  tagline: 'Enterprise component discovery, governance, and catalog generation for AEM as a Cloud Service',
  favicon: 'img/icon.svg',

  future: {
    v4: true,
  },

  url: 'https://mayur434.github.io',
  baseUrl: '/aem-component-catalog-vs-extension/',

  organizationName: 'mayur434',
  projectName: 'aem-component-catalog-vs-extension',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/',
          editUrl: 'https://github.com/mayur434/aem-component-catalog-vs-extension/tree/main/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/icon.svg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'AEM Component Catalog',
        logo: {
          alt: 'AEM Component Catalog logo',
          src: 'img/icon.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Documentation',
          },
          {
            href: 'https://github.com/mayur434/aem-component-catalog-vs-extension',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              {label: 'Introduction', to: '/intro'},
              {label: 'Features & Capabilities', to: '/features'},
              {label: 'Usage Manual', to: '/usage-manual/getting-started'},
              {label: 'Business Outcomes', to: '/outcomes'},
            ],
          },
          {
            title: 'Project',
            items: [
              {label: 'Source repository', href: 'https://github.com/mayur434/aem-component-catalog-vs-extension'},
              {label: 'Security policy', href: 'https://github.com/mayur434/aem-component-catalog-vs-extension/blob/main/SECURITY.md'},
              {label: 'Changelog', href: 'https://github.com/mayur434/aem-component-catalog-vs-extension/blob/main/CHANGELOG.md'},
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} AEM Component Catalog. Licensed under the MIT License.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
