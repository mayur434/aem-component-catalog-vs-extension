/**
 * Detect-and-guide remediations.
 *
 * Each remediation turns a known Cloud Doctor / preflight finding into a concrete,
 * reviewable set of file actions. Planning is pure (no writes) so the caller can
 * present a diff and let the user approve each fix. Applying writes atomically,
 * backs up every file it changes under the project state root, and appends an
 * audit record. Remediations only ever touch source metadata and documentation —
 * never generated artifacts, which remain owned by the transactional engine.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getDefaults } from '../config/defaults';
import type { ComponentLibraryConfig } from '../config/schema';
import { defaultPolicy } from './policy';
import { parseAemCloudProject } from '../scanner/projectDetector';
import { scanComponents } from '../scanner/componentScanner';
import { assertPathInside, safeRelativePath } from '../utils/pathSecurity';

export interface RemediationAction {
  relativePath: string;
  absolutePath: string;
  kind: 'create' | 'update';
  content: string;
  mode: number;
  summary: string;
}

export interface Remediation {
  id: string;
  title: string;
  description: string;
  /** Safe remediations may be auto-applied; unsafe ones always require review. */
  safe: boolean;
  /** Cloud Doctor / preflight rule ids this remediation resolves. */
  resolves: string[];
  plan(projectRoot: string, config: ComponentLibraryConfig | null): RemediationAction[];
}

export interface ApplyRemediationResult {
  backupDir: string | null;
  actions: Array<{ relativePath: string; kind: 'create' | 'update' }>;
}

const GOVERNANCE_DEFAULTS = { owner: 'Unassigned', status: 'draft', version: '1.0' } as const;

const REMEDIATIONS: Remediation[] = [
  {
    id: 'create-config',
    title: 'Create catalog configuration',
    description: 'Write .component-library.json and .aem-catalog-policy.json with AEMaaCS enterprise defaults.',
    safe: true,
    resolves: ['catalog.config'],
    plan(projectRoot) {
      const project = parseAemCloudProject(projectRoot);
      if (!project) throw new Error('No AEM as a Cloud Service project was detected to configure.');
      const config = getDefaults(project.artifactId);
      config.output.servletPackage = project.javaPackage;
      config.hero.badge = project.artifactId;
      config.hero.titlePrefix = project.artifactId;
      const actions: RemediationAction[] = [
        action(projectRoot, '.component-library.json', `${JSON.stringify(config, null, 2)}\n`, 'Create catalog configuration'),
      ];
      const policyFile = config.governance.policyFile;
      if (!fs.existsSync(path.join(projectRoot, policyFile))) {
        actions.push(action(projectRoot, policyFile, `${JSON.stringify(defaultPolicy(), null, 2)}\n`, 'Create governance policy'));
      }
      return actions;
    },
  },
  {
    id: 'create-policy-file',
    title: 'Create governance policy',
    description: 'Write the recommended AEMaaCS policy so Cloud Doctor severities are explicit.',
    safe: true,
    resolves: ['catalog.config'],
    plan(projectRoot, config) {
      const policyFile = config?.governance.policyFile ?? '.aem-catalog-policy.json';
      return [action(projectRoot, policyFile, `${JSON.stringify(defaultPolicy(), null, 2)}\n`, 'Create governance policy')];
    },
  },
  {
    id: 'scaffold-governance-metadata',
    title: 'Seed missing governance metadata',
    description:
      'Add owner, lifecycle status, and version properties (safe defaults) to components that are missing them, lifting quality scores and clearing governance findings.',
    safe: false,
    resolves: ['component.require-owner', 'component.require-status', 'component.require-version', 'component.minimum-quality'],
    plan(projectRoot, config) {
      if (!config) throw new Error('A valid catalog configuration is required to seed governance metadata.');
      const actions: RemediationAction[] = [];
      for (const component of scanComponents(projectRoot, config).components) {
        const additions: Record<string, string> = {};
        if (!component.owner) additions[config.governance.ownerProperty] = GOVERNANCE_DEFAULTS.owner;
        if (!component.status) additions[config.governance.statusProperty] = GOVERNANCE_DEFAULTS.status;
        if (!component.version) additions[config.governance.versionProperty] = GOVERNANCE_DEFAULTS.version;
        if (Object.keys(additions).length === 0) continue;
        const injected = injectAttributes(fs.readFileSync(component.sourcePath, 'utf-8'), additions);
        if (!injected) continue;
        actions.push(
          updateAction(
            projectRoot,
            component.sourcePath,
            injected,
            `Add ${Object.keys(additions).join(', ')} to ${component.title}`,
          ),
        );
      }
      return actions;
    },
  },
  {
    id: 'scaffold-readme',
    title: 'Scaffold component READMEs',
    description: 'Create a README.md documentation stub for every component that does not have one.',
    safe: false,
    resolves: ['component.require-readme'],
    plan(projectRoot, config) {
      if (!config) throw new Error('A valid catalog configuration is required to scaffold READMEs.');
      const actions: RemediationAction[] = [];
      for (const component of scanComponents(projectRoot, config).components) {
        if (component.hasReadme) continue;
        const readme = path.join(path.dirname(component.sourcePath), 'README.md');
        actions.push(action(projectRoot, safeRelativePath(projectRoot, readme), readmeStub(component.title, component.description, component.resourceType), `Scaffold README for ${component.title}`));
      }
      return actions;
    },
  },
];

export function availableRemediations(): Remediation[] {
  return [...REMEDIATIONS];
}

export function getRemediation(id: string): Remediation | undefined {
  return REMEDIATIONS.find((remediation) => remediation.id === id);
}

/** Map a Cloud Doctor rule id to the remediations that can resolve it. */
export function remediationsForRule(ruleId: string): Remediation[] {
  return REMEDIATIONS.filter((remediation) => remediation.resolves.includes(ruleId));
}

export function planRemediation(
  id: string,
  projectRoot: string,
  config: ComponentLibraryConfig | null,
): RemediationAction[] {
  const remediation = getRemediation(id);
  if (!remediation) throw new Error(`Unknown remediation: ${id}`);
  return remediation.plan(projectRoot, config);
}

export function applyRemediationActions(
  projectRoot: string,
  actions: RemediationAction[],
  actor: string,
  now = new Date(),
): ApplyRemediationResult {
  if (actions.length === 0) return { backupDir: null, actions: [] };
  const stateRoot = assertPathInside(projectRoot, path.join(projectRoot, '.aem-catalog'), 'State directory');
  const backupDir = path.join(stateRoot, 'remediation-backups', now.toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const applied: Array<{ relativePath: string; kind: 'create' | 'update' }> = [];
  for (const item of actions) {
    const absolute = assertPathInside(projectRoot, item.absolutePath, 'Remediation target');
    if (fs.existsSync(absolute)) {
      const backup = path.join(backupDir, ...item.relativePath.split('/'));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(absolute, backup);
    }
    atomicWrite(absolute, item.content, item.mode);
    applied.push({ relativePath: item.relativePath, kind: item.kind });
  }
  appendAudit(stateRoot, actor, applied, now);
  return { backupDir, actions: applied };
}

/**
 * Insert JCR attributes into a component's `.content.xml` after the
 * `jcr:primaryType="cq:Component"` token. Returns null if the node is not a
 * component or every requested attribute already exists. Values are XML-escaped.
 */
export function injectAttributes(xml: string, additions: Record<string, string>): string | null {
  const rootMatch = xml.match(/<jcr:root\b[^>]*>/s);
  if (!rootMatch || !/jcr:primaryType="cq:Component"/.test(rootMatch[0])) return null;
  const pending = Object.entries(additions).filter(([name]) => !new RegExp(`\\b${escapeRegExp(name)}=`).test(rootMatch[0]));
  if (pending.length === 0) return null;
  const inserted = pending.map(([name, value]) => `\n    ${name}="${escapeXml(value)}"`).join('');
  // A string pattern replaces only the first occurrence, which is the node root.
  return xml.replace('jcr:primaryType="cq:Component"', `jcr:primaryType="cq:Component"${inserted}`);
}

function readmeStub(title: string, description: string, resourceType: string): string {
  return `# ${title}

${description || '_Describe what this component does and when to use it._'}

## Usage

\`\`\`html
<sly data-sly-resource="\${'${slug(title)}' @ resourceType='${resourceType}'}"/>
\`\`\`

## Authoring

_Document the dialog fields and authoring guidance here._

## Notes

_Add accessibility, responsiveness, or integration notes here._
`;
}

function action(projectRoot: string, relativePath: string, content: string, summary: string): RemediationAction {
  const absolutePath = assertPathInside(projectRoot, path.join(projectRoot, relativePath), 'Remediation target');
  return {
    relativePath,
    absolutePath,
    kind: fs.existsSync(absolutePath) ? 'update' : 'create',
    content,
    mode: 0o644,
    summary,
  };
}

function updateAction(projectRoot: string, absolutePath: string, content: string, summary: string): RemediationAction {
  const resolved = assertPathInside(projectRoot, absolutePath, 'Remediation target');
  return {
    relativePath: safeRelativePath(projectRoot, resolved),
    absolutePath: resolved,
    kind: 'update',
    content,
    mode: fs.existsSync(resolved) ? fs.statSync(resolved).mode & 0o777 : 0o644,
    summary,
  };
}

function atomicWrite(file: string, content: string, mode: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf-8', mode });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, mode);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function appendAudit(
  stateRoot: string,
  actor: string,
  actions: Array<{ relativePath: string; kind: string }>,
  now: Date,
): void {
  const auditFile = path.join(stateRoot, 'audit.jsonl');
  fs.mkdirSync(path.dirname(auditFile), { recursive: true, mode: 0o700 });
  fs.appendFileSync(
    auditFile,
    `${JSON.stringify({ timestamp: now.toISOString(), actor, outcome: 'remediation', files: actions })}\n`,
    { encoding: 'utf-8', mode: 0o600 },
  );
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'component';
}
