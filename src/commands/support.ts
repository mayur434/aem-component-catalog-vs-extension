import * as vscode from 'vscode';
import { createSupportBundle } from '../core/supportBundle';
import { selectAemProject } from './projectSelection';

export async function supportBundleCommand(requestedRoot?: string): Promise<void> {
  const project = await selectAemProject(requestedRoot, 'Select the AEM project for diagnostics');
  if (!project) return;
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(vscode.Uri.file(project.root), 'aem-catalog-support.json'),
    filters: { JSON: ['json'] },
    saveLabel: 'Export Redacted Support Bundle',
  });
  if (!target) return;
  const bundle = createSupportBundle(project.root);
  await vscode.workspace.fs.writeFile(target, Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf-8'));
  vscode.window.showInformationMessage('Redacted AEM component catalog support bundle exported.');
}
