// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    'features',
    'architecture',
    {
      type: 'category',
      label: 'Usage Manual',
      collapsed: false,
      items: [
        'usage-manual/getting-started',
        'usage-manual/commands-reference',
        'usage-manual/configuration-and-governance',
        'usage-manual/generation-safety-and-ci',
        'usage-manual/troubleshooting',
      ],
    },
    'outcomes',
  ],
};

export default sidebars;
