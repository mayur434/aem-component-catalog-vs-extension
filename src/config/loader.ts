/**
 * Load, validate, and merge .component-library.json with defaults.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ComponentLibraryConfig } from './schema';
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

  const migrated = migrateConfig(userConfig);
  const merged = deepMerge(getDefaults(migrated.appId), migrated) as ComponentLibraryConfig;

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
  } else if (!/^[a-z][a-z0-9-]*$/.test(config.appId)) {
    errors.push(
      'appId must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens',
    );
  }

  if (config.schemaVersion !== 2) {
    errors.push('schemaVersion must be 2');
  }

  // output
  if (!config.output.servletPackage || !config.output.servletPackage.trim()) {
    errors.push('output.servletPackage is required');
  } else if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(config.output.servletPackage)) {
    errors.push('output.servletPackage must be a valid Java package name (e.g. com.example.core.servlets)');
  }

  if (!config.output.contentPath || !config.output.contentPath.startsWith('/content/')) {
    errors.push('output.contentPath must start with /content/');
  } else if (!isSafeJcrPath(config.output.contentPath)) {
    errors.push('output.contentPath contains unsafe path segments');
  }

  if (!config.output.pageResourceType || !config.output.pageResourceType.trim()) {
    errors.push('output.pageResourceType is required');
  } else if (!/^[a-z0-9][a-z0-9/_-]*$/.test(config.output.pageResourceType)) {
    errors.push('output.pageResourceType must be a safe relative resource type');
  }

  if (!config.output.pageSuperType || !config.output.pageSuperType.trim()) {
    errors.push('output.pageSuperType is required');
  } else if (!/^[a-z0-9][a-z0-9/_-]*$/.test(config.output.pageSuperType)) {
    errors.push('output.pageSuperType must be a safe relative resource type');
  }

  if (!config.output.assetRoot || !config.output.assetRoot.startsWith('/content/dam/')) {
    errors.push('output.assetRoot must start with /content/dam/');
  } else if (!isSafeJcrPath(config.output.assetRoot)) {
    errors.push('output.assetRoot contains unsafe path segments');
  }

  if (!config.output.clientlibCategory || !config.output.clientlibCategory.trim()) {
    errors.push('output.clientlibCategory is required');
  } else if (!/^[a-zA-Z0-9._-]+$/.test(config.output.clientlibCategory)) {
    errors.push('output.clientlibCategory contains unsupported characters');
  }

  // service user
  if (!config.serviceUser.name || !config.serviceUser.name.trim()) {
    errors.push('serviceUser.name is required');
  }
  if (!config.serviceUser.bundleSymbolicName || !config.serviceUser.bundleSymbolicName.trim()) {
    errors.push('serviceUser.bundleSymbolicName is required');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(config.serviceUser.name)) {
    errors.push('serviceUser.name contains unsupported characters');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(config.serviceUser.subServiceName)) {
    errors.push('serviceUser.subServiceName contains unsupported characters');
  }

  // brand colors - validate hex format
  const hexPattern = /^#[0-9a-fA-F]{3,8}$/;
  const colorFields: Array<keyof typeof config.brand> = [
    'primary',
    'primaryLight',
    'primaryDark',
    'primaryDeeper',
    'accent',
    'accentHover',
    'gold',
    'sky',
    'background',
  ];
  for (const field of colorFields) {
    const val = config.brand[field];
    if (val && typeof val === 'string' && !hexPattern.test(val)) {
      errors.push(`brand.${field} must be a valid hex color (got "${val}")`);
    }
  }
  for (const field of ['font', 'fontFallback'] as const) {
    if (!config.brand[field] || /[{};<>\u0000-\u001f]/.test(config.brand[field])) {
      errors.push(`brand.${field} contains unsafe CSS characters`);
    }
  }

  // components root
  if (!config.components.root || !config.components.root.startsWith('/apps/')) {
    errors.push('components.root must start with /apps/');
  } else if (!isSafeJcrPath(config.components.root)) {
    errors.push('components.root contains unsafe path segments');
  }

  if (config.catalog.deploymentTarget !== 'author') {
    errors.push('catalog.deploymentTarget must be "author" for the AEMaaCS enterprise catalog');
  }
  for (const [name, value] of Object.entries({
    ownerProperty: config.governance.ownerProperty,
    statusProperty: config.governance.statusProperty,
    versionProperty: config.governance.versionProperty,
    tagsProperty: config.governance.tagsProperty,
  })) {
    if (!/^[a-zA-Z_][a-zA-Z0-9:_-]*$/.test(value)) {
      errors.push(`governance.${name} must be a valid JCR property name`);
    }
  }
  if (
    !config.governance.policyFile ||
    path.isAbsolute(config.governance.policyFile) ||
    config.governance.policyFile.split(/[\\/]/).includes('..')
  ) {
    errors.push('governance.policyFile must be a project-relative path without parent traversal');
  }
  if (config.taxonomy) {
    if (!/^[a-zA-Z_][a-zA-Z0-9:_-]*$/.test(config.taxonomy.subCategoryProperty)) {
      errors.push('taxonomy.subCategoryProperty must be a valid JCR property name');
    }
    for (const [key, label] of Object.entries(config.taxonomy.categoryLabels ?? {})) {
      if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
        errors.push(`taxonomy.categoryLabels key "${key}" must be a safe folder segment`);
      }
      if (typeof label !== 'string' || /[<>\u0000-\u001f]/.test(label)) {
        errors.push(`taxonomy.categoryLabels["${key}"] must be a safe label`);
      }
    }
  }
  if (
    !Number.isInteger(config.catalog.cacheSeconds) ||
    config.catalog.cacheSeconds < 0 ||
    config.catalog.cacheSeconds > 3600
  ) {
    errors.push('catalog.cacheSeconds must be an integer between 0 and 3600');
  }
  if (
    !Number.isInteger(config.catalog.pageSize) ||
    config.catalog.pageSize < 25 ||
    config.catalog.pageSize > 1000
  ) {
    errors.push('catalog.pageSize must be an integer between 25 and 1000');
  }
  if (!config.catalog.usageCron || !/^[-0-9*?/,\s]+$/.test(config.catalog.usageCron)) {
    errors.push('catalog.usageCron must be a valid quartz cron expression');
  }

  return errors;
}

/** Upgrade v1/unversioned configuration without mutating the caller's object. */
export function migrateConfig(input: Record<string, any>): Record<string, any> {
  const migrated = JSON.parse(JSON.stringify(input)) as Record<string, any>;
  delete migrated.projectType;
  migrated.schemaVersion = 2;
  if (migrated.features?.groupFilter !== undefined && migrated.features.groupFilters === undefined) {
    migrated.features.groupFilters = migrated.features.groupFilter;
    delete migrated.features.groupFilter;
  }
  if (migrated.serviceUser?.systemUser && !migrated.serviceUser.name) {
    migrated.serviceUser.name = migrated.serviceUser.systemUser;
    delete migrated.serviceUser.systemUser;
  }
  return migrated;
}

export function saveConfig(projectRoot: string, config: Partial<ComponentLibraryConfig>): void {
  const cfgFile = configPath(projectRoot);
  const temporary = `${cfgFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temporary, cfgFile);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
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

function isSafeJcrPath(value: string): boolean {
  return (
    !value.includes('..') &&
    !/[\\\u0000-\u001f"'<>]/.test(value) &&
    value.split('/').every((segment) => !segment || /^[a-zA-Z0-9._:-]+$/.test(segment))
  );
}
