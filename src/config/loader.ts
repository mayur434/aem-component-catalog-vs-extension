/**
 * Load, validate, and merge .component-library.json with defaults.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ComponentLibraryConfig } from './schema';
import { getDefaults } from './defaults';

const CONFIG_FILE = '.component-library.json';

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_FILE);
}

export function configExists(projectRoot: string): boolean {
  return fs.existsSync(configPath(projectRoot));
}

export function loadConfig(projectRoot: string): ComponentLibraryConfig {
  const cfgFile = configPath(projectRoot);
  if (!fs.existsSync(cfgFile)) {
    throw new Error(`Config not found: ${cfgFile}. Run "AEM Component Library: Init" first.`);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(cfgFile, 'utf-8');
  } catch (e: any) {
    throw new Error(`Cannot read config file: ${e.message}`);
  }

  let userConfig: any;
  try {
    userConfig = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Invalid JSON in .component-library.json: ${e.message}`);
  }

  if (!userConfig || typeof userConfig !== 'object') {
    throw new Error('.component-library.json must contain a JSON object.');
  }

  if (!userConfig.appId || typeof userConfig.appId !== 'string' || !userConfig.appId.trim()) {
    throw new Error('"appId" is required and must be a non-empty string in .component-library.json');
  }

  const merged = deepMerge(getDefaults(userConfig.appId), userConfig) as ComponentLibraryConfig;

  // Validate critical fields after merge
  const errors = validateConfig(merged);
  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n• ${errors.join('\n• ')}`);
  }

  return merged;
}

/**
 * Validate a merged config for required fields and basic correctness.
 */
export function validateConfig(config: ComponentLibraryConfig): string[] {
  const errors: string[] = [];

  // appId
  if (!config.appId || !config.appId.trim()) {
    errors.push('appId is required');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(config.appId)) {
    errors.push('appId must contain only letters, numbers, hyphens, and underscores');
  }

  // output
  if (!config.output.servletPackage || !config.output.servletPackage.trim()) {
    errors.push('output.servletPackage is required');
  } else if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(config.output.servletPackage)) {
    errors.push('output.servletPackage must be a valid Java package name (e.g. com.example.core.servlets)');
  }

  if (!config.output.contentPath || !config.output.contentPath.startsWith('/content/')) {
    errors.push('output.contentPath must start with /content/');
  }

  if (!config.output.pageResourceType || !config.output.pageResourceType.trim()) {
    errors.push('output.pageResourceType is required');
  }

  if (!config.output.clientlibCategory || !config.output.clientlibCategory.trim()) {
    errors.push('output.clientlibCategory is required');
  }

  // service user
  if (!config.serviceUser.name || !config.serviceUser.name.trim()) {
    errors.push('serviceUser.name is required');
  }
  if (!config.serviceUser.bundleSymbolicName || !config.serviceUser.bundleSymbolicName.trim()) {
    errors.push('serviceUser.bundleSymbolicName is required');
  }

  // brand colors - validate hex format
  const hexPattern = /^#[0-9a-fA-F]{3,8}$/;
  const colorFields: Array<keyof typeof config.brand> = [
    'primary', 'primaryLight', 'primaryDark', 'primaryDeeper',
    'accent', 'accentHover', 'gold', 'sky', 'background',
  ];
  for (const field of colorFields) {
    const val = config.brand[field];
    if (val && typeof val === 'string' && !hexPattern.test(val)) {
      errors.push(`brand.${field} must be a valid hex color (got "${val}")`);
    }
  }

  // components root
  if (!config.components.root || !config.components.root.startsWith('/apps/')) {
    errors.push('components.root must start with /apps/');
  }

  return errors;
}

export function saveConfig(projectRoot: string, config: Partial<ComponentLibraryConfig>): void {
  const cfgFile = configPath(projectRoot);
  fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
