import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { configExists, loadConfig, validateConfig } from '../config/loader';
import type { ComponentLibraryConfig } from '../config/schema';
import { scanComponents, type ScanResult, type ScannedComponent } from '../scanner/componentScanner';
import { parseAemProject, type ProjectInfo } from '../scanner/projectDetector';
import { buildGenerationPlan } from './generation';
import {
  defaultPolicy,
  loadPolicy,
  policyLevel,
  type EnterprisePolicy,
  type FindingSeverity,
} from './policy';

export interface DoctorFinding {
  ruleId: string;
  severity: FindingSeverity;
  title: string;
  message: string;
  file?: string;
  line?: number;
  component?: string;
  recommendation?: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  project: ProjectInfo | null;
  policy: EnterprisePolicy;
  findings: DoctorFinding[];
  summary: {
    errors: number;
    warnings: number;
    information: number;
    components: number;
    averageQualityScore: number;
    passed: boolean;
  };
  scan: ScanResult | null;
}

export interface DoctorOptions {
  policyFile?: string;
  config?: ComponentLibraryConfig;
}

export function runDoctor(projectRoot: string, options: DoctorOptions = {}): DoctorReport {
  const root = path.resolve(projectRoot);
  let policy = defaultPolicy();
  const findings: DoctorFinding[] = [];
  try {
    policy = loadPolicy(root, options.policyFile);
  } catch (error) {
    findings.push({
      ruleId: 'catalog.config',
      severity: 'error',
      title: 'Policy file is invalid',
      message: errorMessage(error),
      file: options.policyFile,
      recommendation: 'Correct the policy JSON or remove it to use the recommended AEMaaCS policy.',
    });
  }

  const add = createFindingAdder(policy, findings);
  const project = parseAemProject(root);
  if (!project) {
    add(
      'aemaacs.project',
      'error',
      'No supported AEM reactor detected',
      'The root POM does not contain recognized markers for AEM as a Cloud Service or AEM as a Managed Service (AMS), or the standard module structure for either platform.',
      'pom.xml',
      'Use the current AEM Cloud or AMS project archetype, or add the appropriate SDK/quickstart dependency markers.',
    );
  }

  inspectModules(root, project, add);
  inspectPackageSeparation(root, add);
  inspectAllEmbeds(root, add);

  let config: ComponentLibraryConfig | null = options.config ?? null;
  if (!config) {
    if (!configExists(root)) {
      add(
        'catalog.config',
        'error',
        'Catalog configuration is missing',
        'No .component-library.json file was found.',
        '.component-library.json',
        'Run “AEM Component Library: Init”.',
      );
    } else {
      try {
        config = loadConfig(root);
      } catch (error) {
        add(
          'catalog.config',
          'error',
          'Catalog configuration is invalid',
          errorMessage(error),
          '.component-library.json',
          'Resolve every schema and validation error before generation.',
        );
      }
    }
  }

  inspectRepoInit(root, config?.appId ?? null, add);

  let scan: ScanResult | null = null;
  if (config) {
    for (const message of validateConfig(config)) {
      add('catalog.config', 'error', 'Invalid catalog configuration', message, '.component-library.json');
    }
    if (config.catalog.deploymentTarget !== 'author') {
      add(
        'catalog.author-only',
        'error',
        'Catalog is not author-only',
        'Enterprise component metadata must not be provisioned on Publish.',
        '.component-library.json',
      );
    }
    scan = scanComponents(root, config);
    inspectComponents(scan.components, policy, add);
    inspectGenerationDrift(root, config, add);
  }

  const summary = {
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    information: findings.filter((finding) => finding.severity === 'info').length,
    components: scan?.total ?? 0,
    averageQualityScore: scan?.averageQualityScore ?? 0,
    passed: !findings.some((finding) => finding.severity === 'error'),
  };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    project,
    policy,
    findings: findings.sort(compareFindings),
    summary,
    scan,
  };
}

export function formatDoctorReport(report: DoctorReport, includeInformation = true): string {
  const status = report.summary.passed ? 'PASS' : 'FAIL';
  const lines = [
    `# AEM Cloud Doctor — ${status}`,
    '',
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Components: ${report.summary.components}`,
    `- Average quality: ${report.summary.averageQualityScore}/100`,
    '',
  ];
  for (const finding of report.findings) {
    if (!includeInformation && finding.severity === 'info') continue;
    const location = finding.file ? ` — ${finding.file}${finding.line ? `:${finding.line}` : ''}` : '';
    lines.push(`## ${finding.severity.toUpperCase()} [${finding.ruleId}] ${finding.title}${location}`);
    lines.push('', finding.message);
    if (finding.component) lines.push('', `Component: \`${finding.component}\``);
    if (finding.recommendation) lines.push('', `Recommendation: ${finding.recommendation}`);
    lines.push('');
  }
  if (report.findings.length === 0) lines.push('No findings.');
  return lines.join('\n');
}

function inspectModules(root: string, project: ProjectInfo | null, add: FindingAdder): void {
  const modules = project?.modules ?? readModules(path.join(root, 'pom.xml'));
  // 'core'/'ui.apps' accept AMS's alternate 'bundle'/'content' naming (see isAmsReactor in
  // projectDetector.ts) - a literal-name-only check here would false-positive "missing
  // module" for a genuinely alternate-named AMS reactor that already passed detection.
  const alternates: Record<string, string[]> = { core: ['core', 'bundle'], 'ui.apps': ['ui.apps', 'content'] };
  for (const required of ['core', 'ui.apps', 'ui.config', 'all']) {
    const names = alternates[required] ?? [required];
    const present = names.some((name) => modules.includes(name) && fs.existsSync(path.join(root, name)));
    if (!present) {
      add(
        'aemaacs.modules',
        'error',
        `Required module is missing: ${required}`,
        `The catalog requires the ${names.join(' or ')} Maven module and directory.`,
        'pom.xml',
      );
    }
  }
  // No Dispatcher check: this tool only generates an author-only component-catalog
  // micro-site and never touches Dispatcher, so its presence or absence is irrelevant.
}

function inspectPackageSeparation(root: string, add: FindingAdder): void {
  inspectPackageType(root, 'ui.apps', 'application', add);
  inspectPackageType(root, 'ui.config', 'container', add);
  inspectPackageType(root, 'all', 'container', add);
  const uiAppsFilter = findFilter(root, 'ui.apps');
  if (!uiAppsFilter) {
    add(
      'aemaacs.package-separation',
      'error',
      'ui.apps workspace filter is missing',
      'The immutable application package must declare an explicit FileVault filter.',
      'ui.apps/src/main/content/META-INF/vault/filter.xml',
    );
  } else {
    for (const filterRoot of readFilterRoots(uiAppsFilter)) {
      // /oak:index is the one sanctioned exception. Adobe requires custom index definitions
      // to ship in the CODE package - "although Oak indexes are mutable at run time, they
      // must be deployed as code so that they can be installed before any mutable packages
      // are installed" - so an /oak:index root in ui.apps is correct, not a violation. A bare
      // /oak:index root is still wrong: it would take ownership of the whole tree and remove
      // Adobe's own product indexes on deploy, so only specific index nodes are allowed.
      if (filterRoot === '/oak:index') {
        add(
          'aemaacs.package-separation',
          'error',
          'ui.apps claims the entire /oak:index tree',
          'A bare /oak:index filter root removes the product indexes shipped by AEM on deploy.',
          path.relative(root, uiAppsFilter),
          'Declare one filter root per custom index, e.g. /oak:index/acme.myIndex-custom-1.',
        );
        continue;
      }
      if (filterRoot.startsWith('/oak:index/')) continue;
      if (!filterRoot.startsWith('/apps/')) {
        add(
          'aemaacs.package-separation',
          'error',
          'ui.apps contains mutable content',
          `Filter root ${filterRoot} is outside /apps.`,
          path.relative(root, uiAppsFilter),
          'Move /content and /conf roots to ui.content or provision baseline structures with RepoInit.',
        );
      }
    }
  }
  const uiConfigFilter = findFilter(root, 'ui.config');
  if (!uiConfigFilter) {
    add(
      'aemaacs.package-separation',
      'error',
      'ui.config workspace filter is missing',
      'The OSGi configuration package must declare an explicit FileVault filter.',
      'ui.config/src/main/content/META-INF/vault/filter.xml',
    );
  } else {
    for (const filterRoot of readFilterRoots(uiConfigFilter)) {
      if (!filterRoot.startsWith('/apps/')) {
        add(
          'aemaacs.package-separation',
          'error',
          'ui.config contains a non-/apps filter',
          `Filter root ${filterRoot} violates the immutable package boundary.`,
          path.relative(root, uiConfigFilter),
        );
      }
    }
  }
}

function inspectPackageType(root: string, module: string, expected: string, add: FindingAdder): void {
  const file = path.join(root, module, 'pom.xml');
  if (!fs.existsSync(file)) return;
  const pom = fs.readFileSync(file, 'utf-8');
  const actual = pom.match(/<packageType>\s*([^<]+)\s*<\/packageType>/)?.[1]?.trim();
  if (actual !== expected) {
    add(
      'aemaacs.package-separation',
      'error',
      `${module} packageType must be ${expected}`,
      actual ? `Found packageType ${actual}.` : 'No FileVault packageType declaration was found.',
      `${module}/pom.xml`,
      `Configure the FileVault package plugin with <packageType>${expected}</packageType>.`,
    );
  }
}

function inspectAllEmbeds(root: string, add: FindingAdder): void {
  const file = path.join(root, 'all', 'pom.xml');
  if (!fs.existsSync(file)) return;
  const pom = fs.readFileSync(file, 'utf-8');
  for (const module of ['core', 'ui.apps', 'ui.config']) {
    if (!pom.includes(module)) {
      add(
        'aemaacs.all-embeds',
        'warning',
        `${module} may not be embedded by all`,
        `The all container POM does not contain the text “${module}”.`,
        'all/pom.xml',
        'Verify the FileVault embeddeds configuration and Maven dependencies.',
      );
    }
  }
}

function inspectRepoInit(root: string, appId: string | null, add: FindingAdder): void {
  const directory = path.join(root, 'ui.config');
  if (!fs.existsSync(directory)) return;
  // The catalog's own file uses the "~<appId>-componentlibrary" suffix (see
  // osgiConfigSuffix in osgiConfigGenerator.ts) so it never collides with the archetype's
  // own bare "~<appId>" RepoInit file. Match on that exact suffix, not a fragile substring
  // like "component" (which would silently miss any appId that doesn't itself contain that
  // word, and could false-positive on unrelated third-party RepoInit files that do).
  const catalogFileName = appId
    ? `org.apache.sling.jcr.repoinit.RepositoryInitializer~${appId}-componentlibrary.cfg.json`
    : null;
  for (const file of findFiles(
    directory,
    (fileName) => fileName.includes('RepositoryInitializer') && fileName.endsWith('.cfg.json'),
  )) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { scripts?: unknown };
      if (!Array.isArray(parsed.scripts) || parsed.scripts.some((script) => typeof script !== 'string')) {
        throw new Error('The scripts property must be an array of strings.');
      }
      // The RepoInit config must apply on author (whether via the plain config/ folder,
      // applying to every run mode, or config.author specifically) - the catalog page,
      // service user, and Oak index all need to exist there. It must NOT be scoped to
      // config.publish only, which would exclude author entirely and break the catalog
      // while never actually exposing anything on publish (the servlet's own runtime
      // check keeps the UI author-only regardless of where this config applies).
      if (catalogFileName && path.basename(file) === catalogFileName && file.split(path.sep).includes('config.publish')) {
        add(
          'catalog.author-only',
          'error',
          'Catalog RepoInit is scoped to publish only',
          'The component catalog RepoInit configuration must apply on author (config/ or config.author), not config.publish only.',
          path.relative(root, file),
        );
      }
    } catch (error) {
      add(
        'aemaacs.repoinit',
        'error',
        'RepoInit OSGi configuration is invalid',
        errorMessage(error),
        path.relative(root, file),
      );
    }
  }
}

function inspectComponents(
  components: ScannedComponent[],
  policy: EnterprisePolicy,
  add: FindingAdder,
): void {
  const seen = new Set<string>();
  for (const component of components) {
    if (seen.has(component.resourceType)) {
      add(
        'catalog.config',
        'error',
        'Duplicate component resource type',
        component.resourceType,
        component.sourcePath,
        undefined,
        component.resourceType,
      );
    }
    seen.add(component.resourceType);
    componentRequirement(component, 'hasDialog', 'component.require-dialog', 'author dialog', add);
    componentRequirement(component, 'hasReadme', 'component.require-readme', 'README documentation', add);
    componentRequirement(component, 'hasThumbnail', 'component.require-thumbnail', 'thumbnail', add);
    componentRequirement(component, 'owner', 'component.require-owner', 'owner metadata', add);
    componentRequirement(component, 'status', 'component.require-status', 'lifecycle status', add);
    componentRequirement(component, 'version', 'component.require-version', 'version metadata', add);
    if (component.status && !policy.allowedStatuses.includes(component.status)) {
      add(
        'component.require-status',
        'warning',
        'Component has an unsupported lifecycle status',
        `“${component.status}” is not one of ${policy.allowedStatuses.join(', ')}.`,
        component.sourcePath,
        undefined,
        component.resourceType,
      );
    }
    if (component.quality.score < policy.minimumQualityScore) {
      add(
        'component.minimum-quality',
        'warning',
        `Component quality is ${component.quality.score}/100`,
        `Missing: ${component.quality.missing.join(', ') || 'none'}.`,
        component.sourcePath,
        'Add the missing documentation, governance metadata, and authoring assets.',
        component.resourceType,
      );
    }
  }
}

function inspectGenerationDrift(root: string, config: ComponentLibraryConfig, add: FindingAdder): void {
  try {
    const plan = buildGenerationPlan(root, config);
    for (const item of plan.items) {
      if (item.status === 'conflict') {
        add(
          'catalog.generated-drift',
          'error',
          'Generated file has unowned changes',
          item.reason ?? 'The generated artifact differs from the ownership manifest.',
          item.relativePath,
          'Review the diff and move durable customization into configuration or an extension point.',
        );
      } else if (item.status === 'update') {
        add(
          'catalog.generated-drift',
          'warning',
          'Generated file is stale',
          'Configuration or generator output has changed.',
          item.relativePath,
          'Run Preview and then Update.',
        );
      }
    }
    for (const orphan of plan.orphanedFiles) {
      add(
        'catalog.generated-drift',
        'warning',
        'Generated file is orphaned',
        'The ownership manifest tracks a file that the current generator no longer produces.',
        orphan,
        'Review and remove it manually if no longer needed.',
      );
    }
  } catch (error) {
    add('catalog.generated-drift', 'error', 'Generation plan cannot be built', errorMessage(error));
  }
}

type FindingAdder = (
  ruleId: string,
  fallback: FindingSeverity,
  title: string,
  message: string,
  file?: string,
  recommendation?: string,
  component?: string,
) => void;

function createFindingAdder(policy: EnterprisePolicy, findings: DoctorFinding[]): FindingAdder {
  return (ruleId, fallback, title, message, file, recommendation, component) => {
    const severity = policyLevel(policy, ruleId, fallback);
    if (severity === 'off') return;
    findings.push({ ruleId, severity, title, message, file, recommendation, component });
  };
}

function componentRequirement(
  component: ScannedComponent,
  property: keyof ScannedComponent,
  ruleId: string,
  label: string,
  add: FindingAdder,
): void {
  if (!component[property]) {
    add(
      ruleId,
      'warning',
      `Component is missing ${label}`,
      `${component.title} does not provide ${label}.`,
      component.sourcePath,
      `Add ${label} to make the component enterprise-ready.`,
      component.resourceType,
    );
  }
}

function readModules(pomFile: string): string[] {
  if (!fs.existsSync(pomFile)) return [];
  try {
    const parser = new XMLParser({ ignoreAttributes: false });
    const value = parser.parse(fs.readFileSync(pomFile, 'utf-8'))?.project?.modules?.module as
      string | string[];
    return value ? (Array.isArray(value) ? value.map(String) : [String(value)]) : [];
  } catch {
    return [];
  }
}

function findFilter(root: string, module: string): string | null {
  const candidates = [
    path.join(root, module, 'src', 'main', 'content', 'META-INF', 'vault', 'filter.xml'),
    path.join(root, module, 'src', 'main', 'content', 'META-INF', 'vault', 'workspace-filter.xml'),
  ];
  return candidates.find(fs.existsSync) ?? null;
}

function readFilterRoots(file: string): string[] {
  const xml = fs.readFileSync(file, 'utf-8');
  return [...xml.matchAll(/<filter\s+[^>]*root=["']([^"']+)["']/g)].map((match) => match[1]);
}

function findFiles(directory: string, predicate: (fileName: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(absolute, predicate));
    else if (predicate(entry.name)) results.push(absolute);
  }
  return results;
}

function compareFindings(left: DoctorFinding, right: DoctorFinding): number {
  const rank = { error: 0, warning: 1, info: 2 };
  return (
    rank[left.severity] - rank[right.severity] ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.title.localeCompare(right.title)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
