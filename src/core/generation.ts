import * as fs from 'fs';
import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import { validateConfig } from '../config/loader';
import type { GeneratedArtifact } from './artifact';
import { planClientlib } from '../generators/clientlibGenerator';
import { planDispatcher } from '../generators/dispatcherGenerator';
import { planOakIndex } from '../generators/oakIndexGenerator';
import { planOsgiConfigs } from '../generators/osgiConfigGenerator';
import { planPageComponent } from '../generators/pageComponentGenerator';
import { planServlet } from '../generators/servletGenerator';
import { resolveAemPaths } from '../utils/aemPaths';
import { hashContent, hashFile } from '../utils/fileOps';
import {
  addToManifest,
  createManifest,
  loadManifest,
  MANIFEST_FILE,
  manifestPath,
  saveManifest,
  type Manifest,
} from '../utils/manifest';
import { assertPathInside, resolveExistingPath, safeRelativePath } from '../utils/pathSecurity';
import { acquireLock } from '../utils/lock';
import { ensureFilterCoverage } from './filterCoverage';
import { ensureOakIndexPackagingAllowed } from './oakIndexPackaging';

export type PlanStatus = 'create' | 'update' | 'unchanged' | 'conflict';

export interface GenerationPlanItem extends GeneratedArtifact {
  relativePath: string;
  status: PlanStatus;
  currentHash?: string;
  generatedHash: string;
  diff: string;
  reason?: string;
}

export interface GenerationPlan {
  projectRoot: string;
  configHash: string;
  createdAt: string;
  items: GenerationPlanItem[];
  orphanedFiles: string[];
  previousManifest: Manifest | null;
}

export interface ApplyOptions {
  overwriteConflicts?: boolean;
  isCancelled?: () => boolean;
  actor?: string;
}

export interface ApplyResult {
  transactionId: string | null;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  files: Array<{ path: string; action: PlanStatus | 'skipped' }>;
}

interface TransactionFile {
  path: string;
  existed: boolean;
  mode: number;
  beforeHash?: string;
  afterHash: string;
}

interface TransactionRecord {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  actor: string;
  configHash: string;
  manifestExisted: boolean;
  files: TransactionFile[];
  rolledBackAt?: string;
}

export function buildGenerationPlan(projectRoot: string, config: ComponentLibraryConfig): GenerationPlan {
  const errors = validateConfig(config);
  if (errors.length) {
    throw new Error(`Configuration is invalid:\n- ${errors.join('\n- ')}`);
  }
  const paths = resolveAemPaths(projectRoot);
  const artifacts = [
    ...planServlet(config, paths),
    ...planPageComponent(config, paths),
    ...planClientlib(config, paths),
    ...planOsgiConfigs(config, paths),
    ...planOakIndex(config, paths),
    ...planDispatcher(config, paths),
  ];
  ensureUniqueArtifacts(paths.root, artifacts);

  const previousManifest = loadManifest(paths.root);
  const configHash = hashContent(stableStringify(config));
  const items = artifacts.map((artifact) => planArtifact(paths.root, artifact, previousManifest));
  const generatedPaths = new Set(items.map((item) => item.relativePath));
  const orphanedFiles = Object.keys(previousManifest?.files ?? {}).filter(
    (file) => !generatedPaths.has(file),
  );
  return {
    projectRoot: paths.root,
    configHash,
    createdAt: new Date().toISOString(),
    items,
    orphanedFiles,
    previousManifest,
  };
}

export function applyGenerationPlan(plan: GenerationPlan, options: ApplyOptions = {}): ApplyResult {
  // Keep the FileVault filters covering the generated /apps paths so the content
  // package builds (and deploys) — runs even on a no-op apply.
  ensureFilterCoverage(plan.projectRoot);
  ensureOakIndexPackagingAllowed(plan.projectRoot);

  const actionable = plan.items.filter(
    (item) =>
      item.status === 'create' ||
      item.status === 'update' ||
      (item.status === 'conflict' && options.overwriteConflicts),
  );
  if (options.isCancelled?.()) {
    throw new Error('Generation cancelled before changes were applied.');
  }
  if (actionable.length === 0) {
    return summarize(plan, null, new Set());
  }

  // Serialize writes: refuse to run while another process holds a live lock, so a
  // CI run and an editor (or two windows) can never interleave file mutations.
  const releaseLock = acquireLock(plan.projectRoot, options.actor ?? 'vscode');
  try {
    return applyLocked(plan, actionable, options);
  } finally {
    releaseLock();
  }
}

function applyLocked(
  plan: GenerationPlan,
  actionable: GenerationPlanItem[],
  options: ApplyOptions,
): ApplyResult {
  const transaction = createTransaction(plan, actionable, options.actor ?? 'vscode');
  const transactionRoot = path.join(ensureStateRoot(plan.projectRoot), 'backups', transaction.id);
  fs.mkdirSync(path.join(transactionRoot, 'files'), { recursive: true, mode: 0o700 });
  backupManifest(plan.projectRoot, transactionRoot);
  writeTransaction(transactionRoot, transaction);
  const applied = new Set<string>();

  try {
    for (const item of actionable) {
      if (options.isCancelled?.()) {
        throw new Error('Generation cancelled; all applied changes were rolled back.');
      }
      const absolute = assertPathInside(plan.projectRoot, item.absolutePath, 'Generated artifact');
      const record = transaction.files.find((file) => file.path === item.relativePath);
      if (!record) {
        throw new Error(`Transaction metadata is missing for ${item.relativePath}`);
      }
      if (record.existed) {
        const backup = path.join(transactionRoot, 'files', ...item.relativePath.split('/'));
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(absolute, backup);
      }
      atomicWrite(absolute, item.content, record.mode);
      applied.add(item.relativePath);
    }

    const manifest = createManifest(plan.configHash);
    for (const item of plan.items) {
      if (item.status === 'conflict' && !applied.has(item.relativePath)) {
        const existing = plan.previousManifest?.files[item.relativePath];
        if (existing) manifest.files[item.relativePath] = existing;
        continue;
      }
      addToManifest(manifest, plan.projectRoot, item.absolutePath, item.content, item.kind);
    }
    for (const orphan of plan.orphanedFiles) {
      const existing = plan.previousManifest?.files[orphan];
      if (existing) manifest.files[orphan] = existing;
    }
    saveManifest(plan.projectRoot, manifest);
    writeTransaction(transactionRoot, transaction);
    appendAudit(plan.projectRoot, transaction, 'applied');
    return summarize(plan, transaction.id, applied);
  } catch (error) {
    rollbackRecord(plan.projectRoot, transactionRoot, transaction, applied);
    appendAudit(plan.projectRoot, transaction, 'failed-and-rolled-back');
    throw error;
  }
}

export function rollbackLastGeneration(projectRoot: string, actor = 'vscode'): string {
  const backupRoot = path.join(ensureStateRoot(projectRoot), 'backups');
  if (!fs.existsSync(backupRoot)) {
    throw new Error('No generation transaction is available to roll back.');
  }
  const candidates = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backupRoot, entry.name))
    .sort()
    .reverse();

  for (const transactionRoot of candidates) {
    const recordFile = path.join(transactionRoot, 'transaction.json');
    if (!fs.existsSync(recordFile)) continue;
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8')) as TransactionRecord;
    if (record.rolledBackAt) continue;
    rollbackRecord(projectRoot, transactionRoot, record, new Set(record.files.map((file) => file.path)));
    record.rolledBackAt = new Date().toISOString();
    writeTransaction(transactionRoot, record);
    appendAudit(projectRoot, { ...record, actor }, 'manual-rollback');
    return record.id;
  }
  throw new Error('All recorded generation transactions have already been rolled back.');
}

export function formatPlan(plan: GenerationPlan): string {
  const lines = [
    `AEMaaCS Component Catalog generation plan`,
    `Project: ${plan.projectRoot}`,
    `Artifacts: ${plan.items.length}`,
    '',
  ];
  for (const item of plan.items) {
    lines.push(`${item.status.toUpperCase().padEnd(9)} ${item.relativePath}`);
  }
  if (plan.orphanedFiles.length) {
    lines.push('', 'Orphaned generated files (never deleted automatically):');
    lines.push(...plan.orphanedFiles.map((file) => `ORPHAN    ${file}`));
  }
  return lines.join('\n');
}

function planArtifact(
  projectRoot: string,
  artifact: GeneratedArtifact,
  manifest: Manifest | null,
): GenerationPlanItem {
  const absolutePath = assertPathInside(projectRoot, artifact.absolutePath, 'Generated artifact');
  const relativePath = safeRelativePath(projectRoot, absolutePath);
  const generatedHash = hashContent(artifact.content);
  if (!fs.existsSync(absolutePath)) {
    return {
      ...artifact,
      absolutePath,
      relativePath,
      generatedHash,
      status: 'create',
      diff: createDiff('', artifact.content),
    };
  }

  const current = fs.readFileSync(absolutePath, 'utf-8');
  const currentHash = hashContent(current);
  if (currentHash === generatedHash) {
    return {
      ...artifact,
      absolutePath,
      relativePath,
      generatedHash,
      currentHash,
      status: 'unchanged',
      diff: '',
    };
  }
  const ownedHash = manifest?.files[relativePath]?.hash;
  const status: PlanStatus = ownedHash && ownedHash === currentHash ? 'update' : 'conflict';
  return {
    ...artifact,
    absolutePath,
    relativePath,
    generatedHash,
    currentHash,
    status,
    reason:
      status === 'conflict'
        ? 'Existing content is not owned by the current manifest or was manually modified.'
        : undefined,
    diff: createDiff(current, artifact.content),
  };
}

function ensureUniqueArtifacts(projectRoot: string, artifacts: GeneratedArtifact[]): void {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    const relative = safeRelativePath(projectRoot, artifact.absolutePath);
    if (seen.has(relative)) {
      throw new Error(`Generator produced duplicate output: ${relative}`);
    }
    seen.add(relative);
  }
}

function createTransaction(
  plan: GenerationPlan,
  actionable: GenerationPlanItem[],
  actor: string,
): TransactionRecord {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  return {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    actor,
    configHash: plan.configHash,
    manifestExisted: fs.existsSync(manifestPath(plan.projectRoot)),
    files: actionable.map((item) => {
      const existed = fs.existsSync(item.absolutePath);
      return {
        path: item.relativePath,
        existed,
        mode: existed ? fs.statSync(item.absolutePath).mode & 0o777 : 0o644,
        beforeHash: existed ? hashFile(item.absolutePath) : undefined,
        afterHash: item.generatedHash,
      };
    }),
  };
}

function rollbackRecord(
  projectRoot: string,
  transactionRoot: string,
  transaction: TransactionRecord,
  applied: Set<string>,
): void {
  for (const record of [...transaction.files].reverse()) {
    if (!applied.has(record.path)) continue;
    const destination = assertPathInside(projectRoot, path.join(projectRoot, ...record.path.split('/')));
    if (record.existed) {
      const backup = path.join(transactionRoot, 'files', ...record.path.split('/'));
      if (fs.existsSync(backup)) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(backup, destination);
        fs.chmodSync(destination, record.mode);
      }
    } else if (fs.existsSync(destination)) {
      fs.unlinkSync(destination);
    }
  }
  const manifestBackup = path.join(transactionRoot, MANIFEST_FILE);
  const destination = manifestPath(projectRoot);
  if (transaction.manifestExisted && fs.existsSync(manifestBackup)) {
    fs.copyFileSync(manifestBackup, destination);
  } else if (!transaction.manifestExisted && fs.existsSync(destination)) {
    fs.unlinkSync(destination);
  }
}

function backupManifest(projectRoot: string, transactionRoot: string): void {
  const source = manifestPath(projectRoot);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(transactionRoot, MANIFEST_FILE));
  }
}

function writeTransaction(transactionRoot: string, transaction: TransactionRecord): void {
  atomicWrite(
    path.join(transactionRoot, 'transaction.json'),
    `${JSON.stringify(transaction, null, 2)}\n`,
    0o600,
  );
}

function appendAudit(projectRoot: string, transaction: TransactionRecord, outcome: string): void {
  const auditFile = path.join(ensureStateRoot(projectRoot), 'audit.jsonl');
  fs.mkdirSync(path.dirname(auditFile), { recursive: true, mode: 0o700 });
  fs.appendFileSync(
    auditFile,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      transactionId: transaction.id,
      actor: transaction.actor,
      outcome,
      configHash: transaction.configHash,
      files: transaction.files.map((file) => ({
        path: file.path,
        beforeHash: file.beforeHash,
        afterHash: file.afterHash,
      })),
    })}\n`,
    { encoding: 'utf-8', mode: 0o600 },
  );
}

function summarize(plan: GenerationPlan, transactionId: string | null, applied: Set<string>): ApplyResult {
  const files = plan.items.map((item) => ({
    path: item.relativePath,
    action:
      item.status === 'conflict' && !applied.has(item.relativePath) ? ('skipped' as const) : item.status,
  }));
  return {
    transactionId,
    created: plan.items.filter((item) => item.status === 'create' && applied.has(item.relativePath)).length,
    updated: plan.items.filter(
      (item) => ['update', 'conflict'].includes(item.status) && applied.has(item.relativePath),
    ).length,
    unchanged: plan.items.filter((item) => item.status === 'unchanged').length,
    skipped: files.filter((file) => file.action === 'skipped').length,
    files,
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

function createDiff(before: string, after: string): string {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const output: string[] = ['--- current', '+++ generated'];
  const length = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < length && output.length < 202; index += 1) {
    if (oldLines[index] === newLines[index]) continue;
    if (oldLines[index] !== undefined) output.push(`-${oldLines[index]}`);
    if (newLines[index] !== undefined) output.push(`+${newLines[index]}`);
  }
  if (output.length >= 202) output.push('... diff truncated ...');
  return output.length === 2 ? '' : output.join('\n');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function ensureStateRoot(projectRoot: string): string {
  const stateRoot = assertPathInside(projectRoot, path.join(projectRoot, '.aem-catalog'), 'State directory');
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  return assertPathInside(projectRoot, resolveExistingPath(stateRoot), 'State directory');
}
