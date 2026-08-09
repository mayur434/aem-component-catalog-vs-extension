import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { ProjectInfo } from '../scanner/projectDetector';
import { getPlatformAdapter } from '../scanner/platformAdapter';
import { buildSuperTypeChain, resolveClassification } from './componentClassifier';
import { parseContentPackages } from './contentPackageParser';
import { detectDuplicates, hashComponentFiles } from './duplicateDetector';
import type {
  AuditComponent,
  AuditOptions,
  AuditRecommendation,
  AuditResult,
  AuditSummary,
  ComponentClassification,
  ContentPackageMeta,
  CrossSiteEntry,
  ProjectAuditInfo,
  UsageCoverage,
  UsageRecord,
} from './types';

const DEFAULT_OPTIONS: AuditOptions = {
  contentPackagePaths: [],
  includeUsagePages: true,
  duplicateThreshold: 50,
};

export function runAudit(projects: ProjectInfo[], options: Partial<AuditOptions> = {}): AuditResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const projectInfos: ProjectAuditInfo[] = projects.map((p) => ({
    root: p.root,
    artifactId: p.artifactId,
    groupId: p.groupId,
    version: p.version,
    platform: p.platform,
    javaVersion: p.javaVersion,
  }));

  const allComponents: AuditComponent[] = [];
  const superTypeMap = new Map<string, string>();

  for (const project of projects) {
    const components = scanProjectComponents(project, superTypeMap);
    allComponents.push(...components);
  }

  for (const comp of allComponents) {
    comp.superTypeChain = buildSuperTypeChain(comp.resourceType, superTypeMap);
    const dir = comp.sourcePath ? path.dirname(comp.sourcePath) : '';
    const result = resolveClassification(comp.resourceType, comp.superType, comp.superTypeChain, dir);
    comp.classification = result.classification;
    comp.classificationDetail = result.detail;
    comp.ootbBase = result.ootbBase;
    comp.customizations = result.customizations;
    const isCoreComponentBased = comp.classification === 'proxied' || comp.classification === 'proxied-customized';
    comp.coreModelOverride = isCoreComponentBased && comp.hasSlingModel;
  }

  let usage = new Map<string, UsageRecord>();
  let contentPackageMeta: ContentPackageMeta = { sitePageCounts: {}, totalPages: 0 };
  if (opts.contentPackagePaths.length > 0) {
    const parsed = parseContentPackages(opts.contentPackagePaths);
    usage = parsed.usage;
    contentPackageMeta = parsed.meta;
  } else {
    usage = buildLocalUsageIndex(projects);
  }

  for (const comp of allComponents) {
    const record = usage.get(comp.resourceType);
    if (record) {
      comp.usageCount = record.count;
      comp.usagePages = opts.includeUsagePages ? record.pages : [];
    }
  }

  const usageCoverage = buildUsageCoverage(projects, allComponents, contentPackageMeta, opts);

  const duplicates = detectDuplicates(allComponents, opts.duplicateThreshold);
  const crossSiteReuse = buildCrossSiteReuse(allComponents);
  const summary = buildSummary(allComponents, duplicates, usage, opts, projects);
  const recommendations = generateRecommendations(allComponents, duplicates, crossSiteReuse, summary);

  allComponents.sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));

  return {
    projects: projectInfos,
    components: allComponents,
    duplicates,
    crossSiteReuse,
    usage,
    usageCoverage,
    contentPackageMeta,
    summary,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

function scanProjectComponents(
  project: ProjectInfo,
  superTypeMap: Map<string, string>,
): AuditComponent[] {
  const components: AuditComponent[] = [];
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const modelIndex = buildModelIndex(project);

  const appsRoots = findAppsRoots(project);
  for (const appsRoot of appsRoots) {
    const componentsDirs = findComponentDirectories(appsRoot);
    for (const compDir of componentsDirs) {
      const site = extractSiteName(appsRoot, compDir);
      walkComponentTree(compDir, compDir, site, project, parser, modelIndex, superTypeMap, components);
    }
  }

  return components;
}

function findAppsRoots(project: ProjectInfo): string[] {
  const roots: string[] = [];
  const adapter = getPlatformAdapter(project.platform);
  const candidates = [
    ...adapter.componentRoots.map((jcrRootRelative) => path.join(project.root, jcrRootRelative, 'apps')),
    // A project's own declared Maven modules are a per-project fallback the
    // platform adapter can't know about — kept local rather than folded into
    // the adapter's platform-wide candidate list.
    ...project.modules.map((moduleName) =>
      path.join(project.root, moduleName, 'src', 'main', 'content', 'jcr_root', 'apps'),
    ),
  ];
  for (const jcrRoot of candidates) {
    if (fs.existsSync(jcrRoot)) {
      roots.push(jcrRoot);
    }
  }
  return [...new Set(roots)];
}

function findComponentDirectories(appsRoot: string): string[] {
  const result: string[] = [];
  try {
    for (const entry of fs.readdirSync(appsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const componentsDir = path.join(appsRoot, entry.name, 'components');
      if (fs.existsSync(componentsDir)) {
        result.push(componentsDir);
      }
    }
  } catch {
    // appsRoot does not exist or is unreadable
  }
  return result;
}

function extractSiteName(appsRoot: string, componentsDir: string): string {
  const relative = path.relative(appsRoot, componentsDir);
  return relative.split(path.sep)[0] || 'unknown';
}

function walkComponentTree(
  baseDir: string,
  dir: string,
  site: string,
  project: ProjectInfo,
  parser: XMLParser,
  modelIndex: Map<string, { className: string }>,
  superTypeMap: Map<string, string>,
  components: AuditComponent[],
): void {
  const definition = path.join(dir, '.content.xml');
  if (fs.existsSync(definition)) {
    try {
      const doc = parser.parse(fs.readFileSync(definition, 'utf-8')) as Record<string, any>;
      const root = doc['jcr:root'] ?? doc;
      const primaryType = prop(root, 'jcr:primaryType');
      if (primaryType === 'cq:Component') {
        const relative = path.relative(baseDir, dir).split(path.sep).join('/');
        const name = relative || path.basename(dir);
        const siteAppName = path.basename(path.dirname(baseDir));
        const resourceType = `${siteAppName}/components/${relative}`.replace(/\/$/, '');
        const superType = prop(root, 'sling:resourceSuperType');

        if (superType) {
          superTypeMap.set(resourceType, superType);
        }

        const model = modelIndex.get(resourceType);
        const hasHtl = dirHasFiles(dir, '.html');
        const hasJsp = dirHasFiles(dir, '.jsp');
        const fileHashes = hashComponentFiles(dir);

        const dialogFieldCount = countDialogFields(dir, parser);
        const dialogTabCount = countDialogTabs(dir, parser);

        components.push({
          name,
          title: prop(root, 'jcr:title') || path.basename(dir),
          description: prop(root, 'jcr:description'),
          group: prop(root, 'componentGroup'),
          resourceType,
          superType,
          superTypeChain: [],
          path: `/apps/${resourceType}`,
          sourcePath: definition,
          site,
          classification: 'custom',
          classificationDetail: '',
          ootbBase: '',
          hasDialog: hasChildDef(dir, '_cq_dialog', 'cq:dialog'),
          hasEditConfig: hasChildDef(dir, '_cq_editConfig', 'cq:editConfig'),
          hasDesignDialog: hasChildDef(dir, '_cq_design_dialog', 'cq:design_dialog'),
          hasReadme: fs.existsSync(path.join(dir, 'README.md')),
          hasHtl,
          hasJsp,
          hasSlingModel: !!model,
          coreModelOverride: false,
          hasClientLib: fs.existsSync(path.join(dir, 'clientlibs')),
          dialogFieldCount,
          dialogTabCount,
          modelClass: model?.className ?? '',
          usageCount: 0,
          usagePages: [],
          fileHashes,
          customizations: [],
        });
      }
    } catch {
      // skip malformed definitions
    }
  }

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_cq_')) {
        walkComponentTree(baseDir, path.join(dir, entry.name), site, project, parser, modelIndex, superTypeMap, components);
      }
    }
  } catch {
    // skip unreadable directories
  }
}

function buildModelIndex(project: ProjectInfo): Map<string, { className: string }> {
  const result = new Map<string, { className: string }>();
  for (const javaRootRelative of getPlatformAdapter(project.platform).modelRoots) {
    const javaRoot = path.join(project.root, javaRootRelative);
    if (!fs.existsSync(javaRoot)) continue;
    walkFiles(javaRoot, (file) => {
      if (!file.endsWith('.java')) return;
      let source: string;
      try {
        source = fs.readFileSync(file, 'utf-8');
      } catch {
        return;
      }
      const modelBlock = source.match(/@Model\s*\(([\s\S]{0,1200}?)\)([\s\S]{0,600}?)\bclass\s+(\w+)/);
      if (!modelBlock) return;
      const resourceTypes = [
        ...modelBlock[1].matchAll(/["']([a-zA-Z0-9/_-]+\/components\/[a-zA-Z0-9/_-]+)["']/g),
      ];
      const packageName = source.match(/^package\s+([\w.]+);/m)?.[1];
      const className = packageName ? `${packageName}.${modelBlock[3]}` : modelBlock[3];
      for (const match of resourceTypes) {
        result.set(match[1], { className });
      }
    });
  }
  return result;
}

function buildLocalUsageIndex(projects: ProjectInfo[]): Map<string, UsageRecord> {
  const usage = new Map<string, UsageRecord>();
  for (const project of projects) {
    for (const jcrRootRelative of getPlatformAdapter(project.platform).usageRoots) {
      const root = path.join(project.root, jcrRootRelative);
      if (!fs.existsSync(root)) continue;
      walkFiles(root, (file) => {
        if (!file.endsWith('.xml')) return;
        let source: string;
        try {
          source = fs.readFileSync(file, 'utf-8');
        } catch {
          return;
        }
        const pagePath = extractPagePathFromFile(root, file);
        for (const match of source.matchAll(/sling:resourceType=["']([^"']+)["']/g)) {
          const rt = match[1];
          const record = usage.get(rt) ?? { resourceType: rt, count: 0, pages: [] };
          record.count++;
          if (pagePath && !record.pages.includes(pagePath) && record.pages.length < 20) {
            record.pages.push(pagePath);
          }
          usage.set(rt, record);
        }
      });
    }
  }
  return usage;
}

function extractPagePathFromFile(root: string, file: string): string {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const parts = relative.split('/');
  const jcrIdx = parts.indexOf('jcr:content');
  if (jcrIdx > 0) return '/' + parts.slice(0, jcrIdx).join('/');
  return '';
}

function buildUsageCoverage(
  projects: ProjectInfo[],
  components: AuditComponent[],
  meta: ContentPackageMeta,
  opts: AuditOptions,
): UsageCoverage[] {
  const projectSitesMap = new Map<string, Set<string>>();
  for (const comp of components) {
    const projectRoot = findProjectForComponent(comp, projects);
    if (!projectRoot) continue;
    const sites = projectSitesMap.get(projectRoot) ?? new Set<string>();
    sites.add(comp.site);
    projectSitesMap.set(projectRoot, sites);
  }

  const contentSiteRoots = new Set(Object.keys(meta.sitePageCounts));
  const hasContentPackages = opts.contentPackagePaths.length > 0;

  return projects.map((project) => {
    const sites = [...(projectSitesMap.get(project.root) ?? [])];
    const coveredSites: string[] = [];
    const uncoveredSites: string[] = [];
    let totalPagesFound = 0;

    for (const site of sites) {
      if (!hasContentPackages) {
        uncoveredSites.push(site);
        continue;
      }
      if (contentSiteRoots.has(site)) {
        coveredSites.push(site);
        totalPagesFound += meta.sitePageCounts[site] ?? 0;
      } else {
        uncoveredSites.push(site);
      }
    }

    return {
      projectArtifactId: project.artifactId,
      projectRoot: project.root,
      sites,
      coveredSites,
      uncoveredSites,
      totalPagesFound,
      hasCoverage: coveredSites.length > 0,
      isPartial: coveredSites.length > 0 && uncoveredSites.length > 0,
    };
  });
}

function findProjectForComponent(comp: AuditComponent, projects: ProjectInfo[]): string | undefined {
  if (!comp.sourcePath) return undefined;
  for (const project of projects) {
    if (comp.sourcePath.startsWith(project.root)) return project.root;
  }
  return undefined;
}

function buildCrossSiteReuse(components: AuditComponent[]): CrossSiteEntry[] {
  const byLeafName = new Map<string, AuditComponent[]>();
  for (const comp of components) {
    const leaf = comp.name.includes('/') ? comp.name.split('/').pop()! : comp.name;
    const group = byLeafName.get(leaf) ?? [];
    group.push(comp);
    byLeafName.set(leaf, group);
  }

  const entries: CrossSiteEntry[] = [];
  for (const [leafName, group] of byLeafName) {
    const sites = [...new Set(group.map((c) => c.site))];
    if (sites.length < 2) continue;

    const allFiles = new Set<string>();
    for (const comp of group) {
      for (const key of comp.fileHashes.keys()) allFiles.add(key);
    }

    let matchCount = 0;
    const differences: string[] = [];
    for (const file of allFiles) {
      const hashes = new Set(group.map((c) => c.fileHashes.get(file)).filter(Boolean));
      if (hashes.size <= 1) {
        matchCount++;
      } else {
        differences.push(file);
      }
    }
    const similarity = allFiles.size > 0 ? Math.round((matchCount / allFiles.size) * 100) : 100;

    entries.push({
      leafName,
      sites,
      identical: similarity === 100,
      similarity,
      differences,
    });
  }

  entries.sort((a, b) => b.sites.length - a.sites.length || a.leafName.localeCompare(b.leafName));
  return entries;
}

function buildSummary(
  components: AuditComponent[],
  duplicates: { componentA: string; componentB: string }[],
  usage: Map<string, UsageRecord>,
  opts: AuditOptions,
  projects: ProjectInfo[],
): AuditSummary {
  const byClassification: Record<ComponentClassification, number> = {
    ootb: 0,
    proxied: 0,
    'proxied-customized': 0,
    custom: 0,
  };
  const byGroup: Record<string, number> = {};
  const bySite: Record<string, number> = {};
  let totalDialogFields = 0;
  let dialogCount = 0;

  for (const comp of components) {
    byClassification[comp.classification]++;
    byGroup[comp.group] = (byGroup[comp.group] ?? 0) + 1;
    bySite[comp.site] = (bySite[comp.site] ?? 0) + 1;
    if (comp.hasDialog) {
      totalDialogFields += comp.dialogFieldCount;
      dialogCount++;
    }
  }

  const unusedComponents = components.filter((c) => c.usageCount === 0).length;
  const hasAms = projects.some((p) => p.platform === 'ams');
  const jspCount = components.filter((c) => c.hasJsp && !c.hasHtl).length;
  const migrationReadiness = hasAms
    ? Math.round(((components.length - jspCount) / Math.max(components.length, 1)) * 100)
    : null;

  return {
    totalComponents: components.length,
    totalSites: Object.keys(bySite).length,
    byClassification,
    byGroup,
    bySite,
    duplicatePairs: duplicates.length,
    unusedComponents,
    usedComponents: components.length - unusedComponents,
    htlComponents: components.filter((c) => c.hasHtl).length,
    jspComponents: jspCount,
    withSlingModel: components.filter((c) => c.hasSlingModel).length,
    withCoreModelOverride: components.filter((c) => c.coreModelOverride).length,
    coreProxiesWithoutModelOverride: components.filter(
      (c) => (c.classification === 'proxied' || c.classification === 'proxied-customized') && !c.coreModelOverride,
    ).length,
    withDialog: dialogCount,
    withoutDialog: components.length - dialogCount,
    averageDialogFields: dialogCount > 0 ? Math.round(totalDialogFields / dialogCount) : 0,
    contentPackagesAnalyzed: opts.contentPackagePaths.length,
    migrationReadiness,
  };
}

function generateRecommendations(
  components: AuditComponent[],
  duplicates: { componentA: string; componentB: string; similarity: number }[],
  crossSite: CrossSiteEntry[],
  summary: AuditSummary,
): AuditRecommendation[] {
  const recs: AuditRecommendation[] = [];

  const unused = components.filter((c) => c.usageCount === 0 && c.classification === 'custom');
  if (unused.length > 0) {
    recs.push({
      category: 'cleanup',
      finding: `${unused.length} custom component(s) have zero usage`,
      impact: 'medium',
      recommendation: 'Review and remove unused components to reduce maintenance burden',
      affectedComponents: unused.map((c) => c.resourceType),
    });
  }

  const exactDupes = duplicates.filter((d) => d.similarity === 100);
  if (exactDupes.length > 0) {
    recs.push({
      category: 'consolidation',
      finding: `${exactDupes.length} pair(s) of identical components across sites`,
      impact: 'high',
      recommendation: 'Extract identical components into a shared library to eliminate duplication',
      affectedComponents: [...new Set(exactDupes.flatMap((d) => [d.componentA, d.componentB]))],
    });
  }

  const nearDupes = duplicates.filter((d) => d.similarity >= 80 && d.similarity < 100);
  if (nearDupes.length > 0) {
    recs.push({
      category: 'consolidation',
      finding: `${nearDupes.length} pair(s) of near-duplicate components (>=80% similarity)`,
      impact: 'medium',
      recommendation: 'Evaluate merging near-duplicate components, using dialog variations or policies for site differences',
      affectedComponents: [...new Set(nearDupes.flatMap((d) => [d.componentA, d.componentB]))],
    });
  }

  if (summary.jspComponents > 0) {
    const jspComps = components.filter((c) => c.hasJsp && !c.hasHtl);
    recs.push({
      category: 'migration',
      finding: `${summary.jspComponents} component(s) still use JSP rendering`,
      impact: 'high',
      recommendation: 'Migrate JSP components to HTL for AEMaaCS compatibility',
      affectedComponents: jspComps.map((c) => c.resourceType),
    });
  }

  const noDialog = components.filter((c) => c.classification === 'custom' && !c.hasDialog);
  if (noDialog.length > 0) {
    recs.push({
      category: 'governance',
      finding: `${noDialog.length} custom component(s) have no authoring dialog`,
      impact: 'low',
      recommendation: 'Add authoring dialogs to custom components for better author experience',
      affectedComponents: noDialog.map((c) => c.resourceType),
    });
  }

  const noModel = components.filter(
    (c) => c.classification === 'custom' && c.hasHtl && !c.hasSlingModel,
  );
  if (noModel.length > 0) {
    recs.push({
      category: 'governance',
      finding: `${noModel.length} HTL component(s) have no Sling Model`,
      impact: 'medium',
      recommendation: 'Add Sling Models for testability and separation of concerns',
      affectedComponents: noModel.map((c) => c.resourceType),
    });
  }

  const deepProxy = components.filter((c) => c.superTypeChain.length > 3);
  if (deepProxy.length > 0) {
    recs.push({
      category: 'performance',
      finding: `${deepProxy.length} component(s) have a super type chain deeper than 3 levels`,
      impact: 'low',
      recommendation: 'Consider flattening deep proxy chains to improve render performance and maintainability',
      affectedComponents: deepProxy.map((c) => c.resourceType),
    });
  }

  const crossSiteMergeable = crossSite.filter((e) => e.identical && e.sites.length >= 2);
  if (crossSiteMergeable.length > 0) {
    recs.push({
      category: 'consolidation',
      finding: `${crossSiteMergeable.length} component(s) are identical across multiple sites`,
      impact: 'high',
      recommendation: 'Consolidate into a shared component library for cross-site reuse',
      affectedComponents: crossSiteMergeable.map((e) => e.leafName),
    });
  }

  recs.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.impact] - order[b.impact];
  });

  return recs;
}

function prop(root: Record<string, any>, name: string): string {
  const value = root[`@_${name}`] ?? root[name];
  return value === undefined || value === null ? '' : String(value);
}

function hasChildDef(dir: string, ...names: string[]): boolean {
  return names.some((name) => {
    const child = path.join(dir, name);
    return fs.existsSync(path.join(child, '.content.xml')) || fs.existsSync(child);
  });
}

function dirHasFiles(dir: string, ext: string): boolean {
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith(ext) && !f.startsWith('.'));
  } catch {
    return false;
  }
}

function countDialogFields(dir: string, parser: XMLParser): number {
  const candidates = [
    path.join(dir, '_cq_dialog', '.content.xml'),
    path.join(dir, 'cq:dialog', '.content.xml'),
  ];
  const file = candidates.find(fs.existsSync);
  if (!file) return 0;
  try {
    const doc = parser.parse(fs.readFileSync(file, 'utf-8')) as Record<string, any>;
    let count = 0;
    countFields(doc, (name) => { if (name.startsWith('./')) count++; });
    return count;
  } catch {
    return 0;
  }
}

function countDialogTabs(dir: string, parser: XMLParser): number {
  const candidates = [
    path.join(dir, '_cq_dialog', '.content.xml'),
    path.join(dir, 'cq:dialog', '.content.xml'),
  ];
  const file = candidates.find(fs.existsSync);
  if (!file) return 0;
  try {
    const doc = parser.parse(fs.readFileSync(file, 'utf-8')) as Record<string, any>;
    let count = 0;
    countFields(doc, (_name, rt) => {
      if (rt === 'granite/ui/components/coral/foundation/tabs') count++;
    });
    return count > 0 ? countTabItems(doc) : 0;
  } catch {
    return 0;
  }
}

function countFields(node: unknown, visit: (name: string, resourceType: string) => void): void {
  if (!node || typeof node !== 'object') return;
  const value = node as Record<string, unknown>;
  const name = String(value['@_name'] ?? '');
  const rt = String(value['@_sling:resourceType'] ?? '');
  if (name || rt) visit(name, rt);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => countFields(item, visit));
    else countFields(child, visit);
  }
}

function countTabItems(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const value = node as Record<string, unknown>;
  const rt = String(value['@_sling:resourceType'] ?? '');
  if (rt === 'granite/ui/components/coral/foundation/tabs') {
    const items = value['items'] as Record<string, unknown> | undefined;
    if (items && typeof items === 'object') {
      return Object.keys(items).filter((k) => !k.startsWith('@_')).length;
    }
  }
  let total = 0;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => { total += countTabItems(item); });
    else total += countTabItems(child);
  }
  return total;
}

function walkFiles(dir: string, visit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, visit);
    else visit(full);
  }
}
