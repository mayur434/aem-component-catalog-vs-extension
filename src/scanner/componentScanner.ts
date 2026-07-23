/** Scan local AEMaaCS component definitions and enterprise metadata. */
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { ComponentLibraryConfig } from '../config/schema';
import { assessComponentQuality, type QualityAssessment } from '../core/quality';

export interface ScannedComponent {
  name: string;
  title: string;
  description: string;
  group: string;
  resourceType: string;
  superType: string;
  dependencies: string[];
  isContainer: boolean;
  hasDialog: boolean;
  hasEditConfig: boolean;
  hasDesignDialog: boolean;
  hasReadme: boolean;
  hasThumbnail: boolean;
  thumbnailFile: string;
  layoutFiles: string[];
  path: string;
  sourcePath: string;
  owner: string;
  status: string;
  version: string;
  tags: string[];
  dialogFields: DialogField[];
  modelClass: string;
  exporter: boolean;
  usageCount: number;
  quality: QualityAssessment;
}

export interface DialogField {
  name: string;
  label: string;
  resourceType: string;
  required: boolean;
}

export interface ScanResult {
  total: number;
  groups: Record<string, number>;
  components: ScannedComponent[];
  averageQualityScore: number;
}

export function scanComponents(projectRoot: string, config: ComponentLibraryConfig): ScanResult {
  const jcrRoot = path.join(projectRoot, 'ui.apps', 'src', 'main', 'content', 'jcr_root');
  const componentsDir = path.join(jcrRoot, ...config.components.root.split('/').filter(Boolean));
  if (!fs.existsSync(componentsDir)) {
    return { total: 0, groups: {}, components: [], averageQualityScore: 0 };
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const modelIndex = buildModelIndex(projectRoot);
  const usageIndex = buildUsageIndex(projectRoot);
  const components: ScannedComponent[] = [];
  const groups: Record<string, number> = {};
  const excludedGroups = new Set(config.components.groups.exclude);
  const layoutExclude = config.components.layouts.exclude.map(globToRegExp);

  walk(componentsDir, (directory) => {
    const definition = path.join(directory, '.content.xml');
    if (!fs.existsSync(definition)) {
      return;
    }
    try {
      const document = parser.parse(fs.readFileSync(definition, 'utf-8')) as Record<string, any>;
      const root = document['jcr:root'] ?? document;
      if (property(root, 'jcr:primaryType') !== 'cq:Component') {
        return;
      }
      const group = property(root, 'componentGroup');
      if (!group || excludedGroups.has(group)) {
        return;
      }

      const relative = path.relative(componentsDir, directory).split(path.sep).join('/');
      const name = relative || path.basename(directory);
      const jcrPath = `${config.components.root}/${relative}`.replace(/\/$/, '');
      const resourceType = jcrPath.replace(/^\/apps\//, '');
      const superType = property(root, 'sling:resourceSuperType');
      const thumbnail = findThumbnail(directory, config, layoutExclude);
      const layoutFiles = findLayouts(directory, config, layoutExclude);
      const owner = property(root, config.governance.ownerProperty);
      const status = property(root, config.governance.statusProperty);
      const version = property(root, config.governance.versionProperty);
      const quality = assessComponentQuality({
        hasDialog: hasChildDefinition(directory, '_cq_dialog', 'cq:dialog'),
        hasReadme: fs.existsSync(path.join(directory, 'README.md')),
        hasThumbnail: thumbnail !== '',
        owner,
        status,
        version,
      });
      const dialogFields = readDialogFields(directory, parser);
      const model = modelIndex.get(resourceType);

      const component: ScannedComponent = {
        name,
        title: property(root, 'jcr:title') || path.basename(directory),
        description: property(root, 'jcr:description'),
        group,
        resourceType,
        superType,
        dependencies: superType ? [superType] : [],
        isContainer: booleanProperty(root, 'cq:isContainer'),
        hasDialog: hasChildDefinition(directory, '_cq_dialog', 'cq:dialog'),
        hasEditConfig: hasChildDefinition(directory, '_cq_editConfig', 'cq:editConfig'),
        hasDesignDialog: hasChildDefinition(directory, '_cq_design_dialog', 'cq:design_dialog'),
        hasReadme: fs.existsSync(path.join(directory, 'README.md')),
        hasThumbnail: thumbnail !== '',
        thumbnailFile: thumbnail,
        layoutFiles,
        path: jcrPath,
        sourcePath: definition,
        owner,
        status,
        version,
        tags: arrayProperty(root, config.governance.tagsProperty),
        dialogFields,
        modelClass: model?.className ?? '',
        exporter: model?.exporter ?? false,
        usageCount: usageIndex.get(resourceType) ?? 0,
        quality,
      };
      components.push(component);
      groups[group] = (groups[group] ?? 0) + 1;
    } catch {
      // A malformed definition is surfaced by Cloud Doctor; scanning remains resilient.
    }
  });

  components.sort((a, b) => a.title.localeCompare(b.title));
  const averageQualityScore = components.length
    ? Math.round(
        components.reduce((total, component) => total + component.quality.score, 0) / components.length,
      )
    : 0;
  return { total: components.length, groups, components, averageQualityScore };
}

function readDialogFields(directory: string, parser: XMLParser): DialogField[] {
  const candidates = [
    path.join(directory, '_cq_dialog', '.content.xml'),
    path.join(directory, 'cq:dialog', '.content.xml'),
  ];
  const file = candidates.find(fs.existsSync);
  if (!file) return [];
  try {
    const document = parser.parse(fs.readFileSync(file, 'utf-8')) as Record<string, any>;
    const fields: DialogField[] = [];
    collectDialogFields(document, fields);
    return fields;
  } catch {
    return [];
  }
}

function collectDialogFields(node: unknown, fields: DialogField[]): void {
  if (!node || typeof node !== 'object') return;
  const value = node as Record<string, unknown>;
  const name = String(value['@_name'] ?? '');
  const resourceType = String(value['@_sling:resourceType'] ?? '');
  if (name.startsWith('./')) {
    fields.push({
      name,
      label: String(value['@_fieldLabel'] ?? value['@_jcr:title'] ?? name.slice(2)),
      resourceType,
      required: ['true', '{Boolean}true'].includes(String(value['@_required'] ?? 'false')),
    });
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => collectDialogFields(item, fields));
    else collectDialogFields(child, fields);
  }
}

function buildModelIndex(projectRoot: string): Map<string, { className: string; exporter: boolean }> {
  const result = new Map<string, { className: string; exporter: boolean }>();
  const javaRoot = path.join(projectRoot, 'core', 'src', 'main', 'java');
  if (!fs.existsSync(javaRoot)) return result;
  walkFiles(javaRoot, (file) => {
    if (!file.endsWith('.java')) return;
    const source = fs.readFileSync(file, 'utf-8');
    const modelBlock = source.match(/@Model\s*\(([\s\S]{0,1200}?)\)([\s\S]{0,600}?)\bclass\s+(\w+)/);
    if (!modelBlock) return;
    const resourceTypes = [
      ...modelBlock[1].matchAll(/["']([a-zA-Z0-9/_-]+\/components\/[a-zA-Z0-9/_-]+)["']/g),
    ];
    const packageName = source.match(/^package\s+([\w.]+);/m)?.[1];
    const className = packageName ? `${packageName}.${modelBlock[3]}` : modelBlock[3];
    for (const match of resourceTypes) {
      result.set(match[1], { className, exporter: /@Exporter\s*\(/.test(source) });
    }
  });
  return result;
}

function buildUsageIndex(projectRoot: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const module of ['ui.content', 'ui.apps']) {
    const root = path.join(projectRoot, module, 'src', 'main', 'content', 'jcr_root');
    if (!fs.existsSync(root)) continue;
    walkFiles(root, (file) => {
      if (!file.endsWith('.xml')) return;
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(/sling:resourceType=["']([^"']+)["']/g)) {
        result.set(match[1], (result.get(match[1]) ?? 0) + 1);
      }
    });
  }
  return result;
}

function walkFiles(directory: string, visit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, visit);
    else visit(absolute);
  }
}

function walk(directory: string, visit: (directory: string) => void): void {
  visit(directory);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_cq_')) {
      walk(path.join(directory, entry.name), visit);
    }
  }
}

function property(root: Record<string, any>, name: string): string {
  const value = root[`@_${name}`] ?? root[name];
  return value === undefined || value === null ? '' : String(value);
}

function booleanProperty(root: Record<string, any>, name: string): boolean {
  return ['true', '{Boolean}true'].includes(property(root, name));
}

function arrayProperty(root: Record<string, any>, name: string): string[] {
  const value = root[`@_${name}`] ?? root[name];
  if (Array.isArray(value)) {
    return value.map(String);
  }
  const text = value === undefined || value === null ? '' : String(value);
  return text
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasChildDefinition(directory: string, ...names: string[]): boolean {
  return names.some((name) => {
    const child = path.join(directory, name);
    return fs.existsSync(path.join(child, '.content.xml')) || fs.existsSync(child);
  });
}

function findThumbnail(directory: string, config: ComponentLibraryConfig, layoutExclude: RegExp[]): string {
  for (const fileName of config.components.thumbnails.fileNames) {
    if (fs.existsSync(path.join(directory, fileName))) {
      return fileName;
    }
  }
  const layoutDirectory = path.join(directory, config.components.layouts.folderName);
  if (!fs.existsSync(layoutDirectory)) {
    return '';
  }
  const fallback = fs
    .readdirSync(layoutDirectory)
    .find((file) => isImage(file) && layoutExclude.some((pattern) => pattern.test(file)));
  return fallback ? `${config.components.layouts.folderName}/${fallback}` : '';
}

function findLayouts(directory: string, config: ComponentLibraryConfig, excluded: RegExp[]): string[] {
  const layoutDirectory = path.join(directory, config.components.layouts.folderName);
  if (!fs.existsSync(layoutDirectory)) {
    return [];
  }
  return fs
    .readdirSync(layoutDirectory)
    .filter((file) => isImage(file) && !excluded.some((pattern) => pattern.test(file)))
    .sort();
}

function isImage(file: string): boolean {
  return /\.(svg|png|jpe?g|webp)$/i.test(file);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}
