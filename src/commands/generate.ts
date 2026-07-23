import * as vscode from 'vscode';
import { configExists, loadConfig } from '../config/loader';
import { runDoctor } from '../core/doctor';
import { applyGenerationPlan, buildGenerationPlan } from '../core/generation';
import { requireTrustedWorkspace, selectAemCloudProject } from './projectSelection';

export async function generateCommand(requestedRoot?: string): Promise<void> {
  await executeGeneration('Generate', requestedRoot);
}

export async function executeGeneration(
  action: 'Generate' | 'Update',
  requestedRoot?: string,
): Promise<void> {
  if (!requireTrustedWorkspace(`${action} component catalog`)) return;
  const project = await selectAemCloudProject(
    requestedRoot,
    `Select the AEMaaCS project to ${action.toLowerCase()}`,
  );
  if (!project) return;
  if (!configExists(project.root)) {
    const choice = await vscode.window.showWarningMessage(
      'No component catalog configuration was found.',
      'Run Init',
    );
    if (choice === 'Run Init') await vscode.commands.executeCommand('aemComponentLibrary.init', project.root);
    return;
  }

  try {
    const config = loadConfig(project.root);
    const doctor = runDoctor(project.root, { config, policyFile: config.governance.policyFile });
    if (!doctor.summary.passed) {
      const choice = await vscode.window.showErrorMessage(
        `AEM Cloud Doctor found ${doctor.summary.errors} blocking issue(s).`,
        'Open Doctor Report',
      );
      if (choice === 'Open Doctor Report')
        await vscode.commands.executeCommand('aemComponentLibrary.doctor', project.root);
      return;
    }

    const plan = buildGenerationPlan(project.root, config);
    const changes = plan.items.filter((item) => item.status !== 'unchanged');
    const conflicts = plan.items.filter((item) => item.status === 'conflict');
    if (!changes.length) {
      vscode.window.showInformationMessage('Component catalog is already up to date.');
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `${action} ${changes.length} artifact(s) transactionally${conflicts.length ? `; ${conflicts.length} conflict(s) will be preserved` : ''}?`,
      {
        modal: true,
        detail: 'A rollback snapshot and an audit record will be created before any file is changed.',
      },
      'Apply Safe Changes',
      'Preview',
    );
    if (choice === 'Preview') {
      await vscode.commands.executeCommand('aemComponentLibrary.preview', project.root);
      return;
    }
    if (choice !== 'Apply Safe Changes') return;

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${action} AEMaaCS component catalog`,
        cancellable: true,
      },
      (_progress, token) =>
        Promise.resolve(
          applyGenerationPlan(plan, {
            isCancelled: () => token.isCancellationRequested,
            actor: 'vscode',
          }),
        ),
    );
    vscode.window.showInformationMessage(
      `${action} complete · ${result.created} created · ${result.updated} updated · ${result.unchanged} unchanged · ${result.skipped} preserved.`,
    );
  } catch (error) {
    vscode.window.showErrorMessage(`${action} failed: ${message(error)}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
