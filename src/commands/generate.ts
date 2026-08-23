import * as vscode from 'vscode';
import { configExists, loadConfig, saveConfig } from '../config/loader';
import { getDefaults } from '../config/defaults';
import { applyGenerationPlan, buildGenerationPlan, type ApplyResult } from '../core/generation';
import { checkGenerationPrerequisites } from '../core/preflight';
import { requireTrustedWorkspace, selectAemProject } from './projectSelection';

export async function generateCommand(requestedRoot?: string): Promise<void> {
  await executeGeneration('Generate', requestedRoot);
}

/**
 * Generate (or update) the component-catalog micro-site.
 *
 * Beyond the platform/ui.config structural gate below, this does nothing else: build
 * the plan and write it. There is no Cloud Doctor gate, no full preflight gate, and no
 * dependency on anything else — a missing dispatcher, low component quality, or absent
 * metadata never block it.
 */
export async function executeGeneration(
  action: 'Generate' | 'Update',
  requestedRoot?: string,
): Promise<void> {
  if (!requireTrustedWorkspace(`${action} component catalog`)) return;
  const project = await selectAemProject(
    requestedRoot,
    `Select the AEM project to ${action.toLowerCase()}`,
  );
  if (!project) return;

  const prerequisites = checkGenerationPrerequisites(project.root);
  if (!prerequisites.ok) {
    vscode.window.showErrorMessage(
      `${action} blocked — this project does not meet the catalog's structural requirements: ${prerequisites.failures.join(' ')}`,
      { modal: true },
    );
    return;
  }

  try {
    if (!configExists(project.root)) {
      // No configuration yet: seed sensible defaults and keep going — never stop
      // to make the user hand-edit JSON first.
      const config = getDefaults(project.artifactId);
      config.output.servletPackage = project.javaPackage;
      config.hero.badge = project.artifactId;
      config.hero.titlePrefix = project.artifactId;
      saveConfig(project.root, config);
    }

    const config = loadConfig(project.root);
    const plan = buildGenerationPlan(project.root, config);
    const changes = plan.items.filter((item) => item.status !== 'unchanged');
    if (!changes.length) {
      vscode.window.showInformationMessage('Component micro-site is already up to date.');
      return;
    }
    const conflicts = plan.items.filter((item) => item.status === 'conflict');
    const choice = await vscode.window.showWarningMessage(
      `${action} ${changes.length} micro-site file(s)${conflicts.length ? `; ${conflicts.length} hand-edited file(s) will be preserved` : ''}?`,
      { modal: true, detail: 'A rollback snapshot is written before any file changes.' },
      `${action} Micro-site`,
    );
    if (choice !== `${action} Micro-site`) return;

    const result = await runGeneration(project.root);
    reportResult(action, result, config.output.contentPath);
  } catch (error) {
    vscode.window.showErrorMessage(`${action} failed: ${message(error)}`);
  }
}

/**
 * Save-less generation primitive used by the visual config panel: build the plan
 * from the on-disk config and apply it. No gating of any kind.
 */
export function runGeneration(projectRoot: string): ApplyResult {
  const config = loadConfig(projectRoot);
  const plan = buildGenerationPlan(projectRoot, config);
  return applyGenerationPlan(plan, { overwriteConflicts: false, actor: 'vscode' });
}

export async function reportResult(
  action: string,
  result: ApplyResult,
  contentPath: string,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `${action} complete · ${result.created} created · ${result.updated} updated · ${result.skipped} preserved. Deploy, then open ${contentPath}.html on Author.`,
    'Copy Author Path',
  );
  if (choice === 'Copy Author Path') await vscode.env.clipboard.writeText(`${contentPath}.html`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
