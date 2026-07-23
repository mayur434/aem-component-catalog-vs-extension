import * as vscode from 'vscode';
import { rollbackLastGeneration } from '../core/generation';
import { requireTrustedWorkspace, selectAemCloudProject } from './projectSelection';

export async function rollbackCommand(requestedRoot?: string): Promise<void> {
  if (!requireTrustedWorkspace('Roll back generated artifacts')) return;
  const project = await selectAemCloudProject(requestedRoot, 'Select the AEMaaCS project to roll back');
  if (!project) return;
  const confirmation = await vscode.window.showWarningMessage(
    'Restore every file from the most recent generation transaction?',
    { modal: true, detail: 'The rollback itself is recorded in the local enterprise audit log.' },
    'Roll Back',
  );
  if (confirmation !== 'Roll Back') return;
  try {
    const transaction = rollbackLastGeneration(project.root);
    vscode.window.showInformationMessage(`Rolled back generation transaction ${transaction}.`);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}
