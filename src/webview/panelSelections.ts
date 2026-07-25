/**
 * Pure (no `vscode` dependency) config <-> panel-selections translation for the
 * "Configure & Generate" webview. Kept separate from configPanel.ts specifically so it
 * can be unit tested without mocking the `vscode` module.
 */
import { configExists, loadConfig } from '../config/loader';
import { getDefaults } from '../config/defaults';
import type { ComponentLibraryConfig } from '../config/schema';

export const TITLE_PRESETS = ['Component Catalog', 'Design System', 'Component Library', 'UI Library', 'Pattern Library'];
export const PRIMARY_SWATCHES = ['#03438E', '#0A66C2', '#005289', '#1D6B3F', '#7A1F2B', '#452B6D', '#00767B', '#1E1E1E'];
export const ACCENT_SWATCHES = ['#4CADE9', '#00ABE8', '#FFD700', '#4CAF50', '#FF7043', '#9C27B0', '#26C6DA', '#F4A62A'];
export const BACKGROUND_SWATCHES = ['#F4F7FB', '#FFFFFF', '#F5F5F7', '#0F1115', '#1E1E1E', '#FAF6EF'];
export const DEFAULT_SUBCATEGORY = 'catalogSubCategory';
export const FEATURES: Array<{
  key: keyof ComponentLibraryConfig['features'];
  label: string;
  hint: string;
  group: 'core' | 'governance';
}> = [
  { key: 'search', label: 'Search bar', hint: 'Full-text search across components', group: 'core' },
  { key: 'groupFilters', label: 'Category filters', hint: 'Filter pills by website/category', group: 'core' },
  { key: 'lightbox', label: 'Screenshot lightbox', hint: 'Zoomable layout previews', group: 'core' },
  { key: 'codeSnippets', label: 'Code snippets', hint: 'Copy-ready HTL usage', group: 'core' },
  { key: 'readme', label: 'README docs', hint: 'Render component READMEs', group: 'core' },
  { key: 'dependencyGraph', label: 'Relationships', hint: 'Super-type siblings on detail pages', group: 'core' },
  { key: 'accessibility', label: 'Accessibility notes', hint: 'A11y guidance section', group: 'core' },
  { key: 'darkMode', label: 'Dark mode', hint: 'Dark theme toggle in the site', group: 'core' },
  {
    key: 'qualityScore',
    label: 'Quality metrics',
    hint: 'Adds a quality score badge to every card — most showcases skip this',
    group: 'governance',
  },
];
const HEX = /^#[0-9a-fA-F]{6}$/;
const JCR_PROPERTY = /^[a-zA-Z_][a-zA-Z0-9:_-]*$/;

export interface PanelProjectRef {
  artifactId: string;
  root: string;
  javaPackage: string;
}

export interface Selections {
  primary: string;
  accent: string;
  background: string;
  brandName: string;
  title: string;
  description: string;
  subCategoryProperty: string;
  features: Record<string, boolean>;
}

/**
 * The saved config if the project has one, otherwise fresh defaults. Both
 * `currentSelections` (populating the form) and `applySelections` (applying it) must
 * start from the same place, or Generate silently drops whatever the form doesn't show.
 */
export function loadExistingOrDefault(root: string, artifactId: string): ComponentLibraryConfig {
  try {
    return configExists(root) ? loadConfig(root) : getDefaults(artifactId);
  } catch {
    return getDefaults(artifactId);
  }
}

export function currentSelections(info: { root: string; artifactId: string }): Selections {
  const config = loadExistingOrDefault(info.root, info.artifactId);
  const features: Record<string, boolean> = {};
  for (const { key } of FEATURES) features[key] = Boolean(config.features[key]);
  const brandName =
    config.hero.titlePrefix && config.hero.titlePrefix !== info.artifactId
      ? config.hero.titlePrefix
      : prettyBrand(info.artifactId);
  return {
    primary: config.brand.primary,
    accent: config.brand.accent,
    background: config.brand.background,
    brandName,
    title: config.output.pageTitle,
    description: config.hero.description,
    subCategoryProperty: config.taxonomy.subCategoryProperty || DEFAULT_SUBCATEGORY,
    features,
  };
}

/**
 * Merge validated, whitelisted selections into the project's EXISTING config (or fresh
 * defaults for a brand-new project) - never rebuild from scratch. The panel only exposes
 * a handful of fields (brand, title, description, sub-category property, features); every
 * other field - catalog.requirePublishedUsage, taxonomy.categoryLabels, governance
 * property names, the Oak index name, anything hand-edited or set by another tool - must
 * survive a Generate click untouched.
 */
export function applySelections(project: PanelProjectRef, message: Record<string, unknown>): ComponentLibraryConfig {
  const config = loadExistingOrDefault(project.root, project.artifactId);
  config.output.servletPackage = project.javaPackage;

  const brandName = safeLine(String(message.brandName ?? ''), 40) || prettyBrand(project.artifactId);
  config.hero.badge = brandName;
  config.hero.titlePrefix = brandName;
  config.hero.footerText = `${brandName} — Component Catalog · Auto-discovered design system`;
  config.hero.description = `Browse the ${brandName} component library — every component, grouped by category, with examples and authoring options.`;

  const primary = HEX.test(String(message.primary ?? '')) ? String(message.primary) : config.brand.primary;
  const accent = HEX.test(String(message.accent ?? '')) ? String(message.accent) : config.brand.accent;
  const background = HEX.test(String(message.background ?? '')) ? String(message.background) : config.brand.background;
  applyBrand(config, primary, accent, background);

  const title = safeLine(String(message.title ?? ''), 80);
  if (title) {
    config.output.pageTitle = title;
    config.hero.titleHighlight = title;
  }
  const description = safeLine(String(message.description ?? ''), 240);
  if (description) config.hero.description = description;

  const property = String(message.subCategoryProperty ?? '');
  if (JCR_PROPERTY.test(property)) config.taxonomy.subCategoryProperty = property;

  const features = (message.features ?? {}) as Record<string, unknown>;
  for (const { key } of FEATURES) config.features[key] = features[key] === true;
  return config;
}

/** Set the whole brand palette from three chosen colors; shades are derived. */
function applyBrand(config: ComponentLibraryConfig, primary: string, accent: string, background: string): void {
  config.brand.primary = primary;
  config.brand.primaryLight = shade(primary, 0.08);
  config.brand.primaryDark = shade(primary, -0.2);
  config.brand.primaryDeeper = shade(primary, -0.4);
  config.brand.accent = accent;
  config.brand.accentHover = shade(accent, -0.12);
  config.brand.background = background;
}

/** Lighten (amt>0) or darken (amt<0) a #rrggbb color; amt in [-1, 1]. */
function shade(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const channels = [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)].map((c) => parseInt(c, 16));
  const target = amt < 0 ? 0 : 255;
  const ratio = Math.min(1, Math.abs(amt));
  const to2 = (c: number): string => Math.round(c).toString(16).padStart(2, '0');
  return `#${channels.map((c) => to2((target - c) * ratio + c)).join('')}`;
}

/** Strip only XML/HTML-breaking characters; keep spaces, hyphens, normal text. */
function safeLine(value: string, max: number): string {
  return value
    .replace(/[<>&"'{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Friendly brand name from an appId: 'pidilite-component-library' -> 'Pidilite'. */
export function prettyBrand(appId: string): string {
  const first = appId.split('-')[0] || appId;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
