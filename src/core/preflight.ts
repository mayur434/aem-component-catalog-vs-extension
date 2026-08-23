/**
 * Generation preflight.
 *
 * Fast, side-effect-free checks that run BEFORE any file is written, so failures
 * are caught while nothing has changed on disk. Where a failure has a known fix,
 * the check carries a `remediationId` the caller can offer as a one-click action
 * (detect-and-guide). Preflight is intentionally lighter than Cloud Doctor and is
 * focused on one question: "can this project be generated safely right now?"
 */
import * as fs from 'fs';
import * as path from 'path';
import { configExists, loadConfig, validateConfig } from '../config/loader';
import type { ComponentLibraryConfig } from '../config/schema';
import { scanComponents } from '../scanner/componentScanner';
import { parseAemProject, type AemPlatform } from '../scanner/projectDetector';
import { buildGenerationPlan } from './generation';
import { isLockStale, readLock } from '../utils/lock';

export type PreflightStatus = 'pass' | 'warn' | 'fail';

export interface GenerationPrerequisites {
  ok: boolean;
  platform: AemPlatform | null;
  /** Human-readable reasons generation is blocked; empty when ok is true. */
  failures: string[];
}

/**
 * Fast, config-independent structural gate: confirms the project is a recognized AEM
 * reactor (AEMaaCS or AEM AMS — both are supported identically) and that ui.config is
 * present, since the service-user mapping and RepoInit configuration this tool generates
 * are written there on either platform. Cheap enough to call before configuration even
 * exists, so callers (VS Code commands, the Configure panel, the CLI) can block
 * initialization/generation up front instead of failing deep inside a write.
 */
export function checkGenerationPrerequisites(projectRoot: string): GenerationPrerequisites {
  const root = path.resolve(projectRoot);
  const project = parseAemProject(root);
  const failures: string[] = [];
  if (!project) {
    failures.push(
      'No supported AEM reactor was detected at this location. A recognized AEM as a Cloud Service or AEM as a Managed Service (AMS) Maven reactor is required.',
    );
  }
  if (!fs.existsSync(path.join(root, 'ui.config'))) {
    failures.push(
      'The ui.config module is missing. It is required on both AEMaaCS and AEM AMS projects to generate the service-user mapping and RepoInit (repository initializer) configuration the catalog depends on.',
    );
  }
  // 'core'/'ui.apps' accept AMS's alternate 'bundle'/'content' naming (see isAmsReactor).
  // Detection (above) can pass via hasCloudApi alone without guaranteeing every module
  // resolveAemPaths needs, so check them explicitly here rather than letting generation
  // crash later with a raw "module not found" error deep inside buildGenerationPlan.
  if (!fs.existsSync(path.join(root, 'core')) && !fs.existsSync(path.join(root, 'bundle'))) {
    failures.push('The core (or bundle) module is missing. It is required to host the generated catalog servlet.');
  }
  if (!fs.existsSync(path.join(root, 'ui.apps')) && !fs.existsSync(path.join(root, 'content'))) {
    failures.push(
      'The ui.apps (or content) module is missing. It is required to host the generated page component and clientlib.',
    );
  }
  if (!fs.existsSync(path.join(root, 'all'))) {
    failures.push('The all module is missing. It is required as the aggregator package for the generated content.');
  }
  return { ok: failures.length === 0, platform: project?.platform ?? null, failures };
}

export interface PreflightCheck {
  id: string;
  title: string;
  status: PreflightStatus;
  detail: string;
  remediationId?: string;
}

export interface PreflightReport {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  checks: PreflightCheck[];
  summary: { passed: boolean; failures: number; warnings: number };
}

export interface PreflightOptions {
  config?: ComponentLibraryConfig;
  /** VS Code workspace trust; leave undefined outside the editor to skip the check. */
  trusted?: boolean;
}

export function runPreflight(projectRoot: string, options: PreflightOptions = {}): PreflightReport {
  const root = path.resolve(projectRoot);
  const checks: PreflightCheck[] = [];
  const add = (check: PreflightCheck): void => {
    checks.push(check);
  };

  if (options.trusted !== undefined) {
    add(
      options.trusted
        ? pass('workspace-trust', 'Workspace is trusted')
        : fail('workspace-trust', 'Workspace is not trusted', 'Trust the workspace to allow the generator to write files.'),
    );
  }

  const project = parseAemProject(root);
  add(
    project
      ? pass('platform-detected', `Detected ${platformLabel(project.platform)} project “${project.artifactId}”`)
      : fail(
          'platform-detected',
          'No supported AEM reactor detected',
          'The root POM lacks recognized AEM as a Cloud Service or AEM as a Managed Service (AMS) markers, or the standard module structure for either platform.',
        ),
  );
  add(
    fs.existsSync(path.join(root, 'ui.config'))
      ? pass('ui-config-present', 'ui.config module is present')
      : fail(
          'ui-config-present',
          'ui.config module is missing',
          'The ui.config module is required on both AEMaaCS and AEM AMS to host the service-user mapping and RepoInit configuration the catalog depends on.',
        ),
  );

  // 'core'/'ui.apps' accept AMS's alternate 'bundle'/'content' naming (see isAmsReactor in
  // projectDetector.ts and resolveAemPaths in aemPaths.ts) - checking only the literal
  // AEMaaCS names here would falsely report a genuinely alternate-named AMS reactor as
  // missing modules it actually has under a different, equally-valid name.
  const missingModules: string[] = [];
  if (!fs.existsSync(path.join(root, 'core')) && !fs.existsSync(path.join(root, 'bundle'))) {
    missingModules.push('core (or bundle)');
  }
  if (!fs.existsSync(path.join(root, 'ui.apps')) && !fs.existsSync(path.join(root, 'content'))) {
    missingModules.push('ui.apps (or content)');
  }
  for (const module of ['ui.config', 'all']) {
    if (!fs.existsSync(path.join(root, module))) missingModules.push(module);
  }
  add(
    missingModules.length === 0
      ? pass('required-modules', 'Required Maven modules are present')
      : fail('required-modules', 'Required Maven modules are missing', `Missing: ${missingModules.join(', ')}.`),
  );

  let config = options.config ?? null;
  if (!config) {
    if (!configExists(root)) {
      add(fail('catalog-config', 'Catalog configuration is missing', 'No .component-library.json was found.', 'create-config'));
    } else {
      try {
        config = loadConfig(root);
        add(pass('catalog-config', 'Catalog configuration is present and valid'));
      } catch (error) {
        add(fail('catalog-config', 'Catalog configuration is invalid', errorMessage(error)));
      }
    }
  } else {
    const errors = validateConfig(config);
    add(
      errors.length === 0
        ? pass('catalog-config', 'Catalog configuration is valid')
        : fail('catalog-config', 'Catalog configuration is invalid', errors.join('; ')),
    );
  }

  // The state directory must be writable to record backups, audit, and the lock.
  add(directoryWritable(root, path.join(root, '.aem-catalog'), 'state-writable', 'project state directory (.aem-catalog)'));

  if (config) {
    guardComponents(root, config, add);
    add(writeTargetsCheck(root));
    guardLock(root, add);
    guardPlan(root, config, add);
  }

  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    checks,
    summary: { passed: failures === 0, failures, warnings },
  };
}

export function formatPreflight(report: PreflightReport): string {
  const glyph: Record<PreflightStatus, string> = { pass: '✔', warn: '▲', fail: '✖' };
  const lines = [
    `AEMaaCS generation preflight — ${report.summary.passed ? 'READY' : 'BLOCKED'}`,
    `Project: ${report.projectRoot}`,
    `Failures: ${report.summary.failures} · Warnings: ${report.summary.warnings}`,
    '',
  ];
  for (const check of report.checks) {
    lines.push(`${glyph[check.status]} [${check.id}] ${check.title}`);
    if (check.detail) lines.push(`    ${check.detail}`);
    if (check.remediationId) lines.push(`    fix: ${check.remediationId}`);
  }
  return lines.join('\n');
}

function guardComponents(
  root: string,
  config: ComponentLibraryConfig,
  add: (check: PreflightCheck) => void,
): void {
  let scan;
  try {
    scan = scanComponents(root, config);
  } catch (error) {
    add(fail('components-present', 'Components could not be scanned', errorMessage(error)));
    return;
  }
  if (scan.total === 0) {
    add(fail('components-present', 'No components found', `Nothing was discovered under ${config.components.root}.`));
    return;
  }
  add(pass('components-present', `${scan.total} components discovered`));

  const missingGovernance = scan.components.filter((component) => !component.owner || !component.status || !component.version).length;
  if (missingGovernance > 0) {
    add(warn('governance-metadata', `${missingGovernance} component(s) missing governance metadata`, 'Owner, status, or version is unset; the catalog will show them as “Unset”.', 'scaffold-governance-metadata'));
  } else {
    add(pass('governance-metadata', 'All components carry governance metadata'));
  }

  const missingReadme = scan.components.filter((component) => !component.hasReadme).length;
  if (missingReadme > 0) {
    add(warn('readme-coverage', `${missingReadme} component(s) missing a README`, 'Detail pages will show no documentation for these components.', 'scaffold-readme'));
  }
}

function writeTargetsCheck(root: string): PreflightCheck {
  const targets = [
    path.join(root, 'core', 'src', 'main', 'java'),
    path.join(root, 'ui.apps', 'src', 'main', 'content'),
    path.join(root, 'ui.config', 'src', 'main', 'content'),
  ];
  const blocked = targets.filter((target) => !nearestWritable(target));
  return blocked.length === 0
    ? pass('write-targets', 'Generation targets are writable')
    : fail('write-targets', 'A generation target is not writable', `Cannot write to: ${blocked.map((target) => path.relative(root, target)).join(', ')}.`);
}

function guardLock(root: string, add: (check: PreflightCheck) => void): void {
  const lock = readLock(root);
  if (!lock) {
    add(pass('generation-lock', 'No competing generation is in progress'));
    return;
  }
  if (isLockStale(lock)) {
    add(warn('generation-lock', 'A stale generation lock was found', `Left by pid ${lock.pid} (${lock.actor}) at ${lock.createdAt}.`, 'clear-stale-lock'));
  } else {
    add(fail('generation-lock', 'A generation is already in progress', `Held by pid ${lock.pid} (${lock.actor}) since ${lock.createdAt}.`));
  }
}

function guardPlan(root: string, config: ComponentLibraryConfig, add: (check: PreflightCheck) => void): void {
  try {
    const plan = buildGenerationPlan(root, config);
    const conflicts = plan.items.filter((item) => item.status === 'conflict').length;
    add(
      conflicts === 0
        ? pass('generation-plan', `Generation plan builds cleanly (${plan.items.length} artifacts)`)
        : warn('generation-plan', `${conflicts} artifact(s) have unowned changes`, 'These files were hand-edited and will be preserved unless you force an overwrite.'),
    );
  } catch (error) {
    add(fail('generation-plan', 'Generation plan cannot be built', errorMessage(error)));
  }
}

function directoryWritable(root: string, target: string, id: string, label: string): PreflightCheck {
  return nearestWritable(target)
    ? pass(id, `Writable: ${label}`)
    : fail(id, `Not writable: ${label}`, `Grant write permission to ${path.relative(root, target) || '.'}.`);
}

/** Walk up to the nearest existing ancestor and test it for write access. */
function nearestWritable(target: string): boolean {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    fs.accessSync(current, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function pass(id: string, title: string): PreflightCheck {
  return { id, title, status: 'pass', detail: '' };
}

function warn(id: string, title: string, detail: string, remediationId?: string): PreflightCheck {
  return { id, title, status: 'warn', detail, remediationId };
}

function fail(id: string, title: string, detail: string, remediationId?: string): PreflightCheck {
  return { id, title, status: 'fail', detail, remediationId };
}

function platformLabel(platform: AemPlatform): string {
  return platform === 'aemaacs' ? 'AEMaaCS' : 'AEM AMS';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
