import * as path from 'path';
import * as vscode from 'vscode';
import { detectAllProjects } from '../scanner/projectDetector';
import { runAudit } from '../audit/auditEngine';
import { generateExcelReport } from '../audit/excelReporter';

export async function auditCommand(requestedRoot?: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  const root = requestedRoot ?? workspaceFolders[0].uri.fsPath;
  const projects = detectAllProjects(root);
  if (projects.length === 0) {
    vscode.window.showErrorMessage('No AEM projects (AEMaaCS or AMS) found in the workspace.');
    return;
  }

  const platformSummary = projects
    .map((p) => `${p.artifactId} (${p.platform === 'aemaacs' ? 'AEMaaCS' : 'AMS'})`)
    .join(', ');

  const contentPackagePaths: string[] = [];
  const addPackages = await vscode.window.showQuickPick(
    [
      { label: 'Yes', description: 'Browse for content package folder' },
      { label: 'No', description: 'Use local project content only' },
    ],
    { placeHolder: 'Do you want to analyze content packages (ZIPs) for usage data?' },
  );

  if (addPackages?.label === 'Yes') {
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: 'Select Content Package Folder',
      title: 'Select folder(s) containing AEM content package ZIPs',
    });
    if (folders) {
      contentPackagePaths.push(...folders.map((f) => f.fsPath));
    }
  }

  const outputUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(root, `aem-component-audit-${dateStamp()}.xlsx`)),
    filters: { 'Excel Workbook': ['xlsx'] },
    title: 'Save Audit Report',
  });

  if (!outputUri) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'AEM Component Audit',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `Scanning ${projects.length} project(s): ${platformSummary}` });
      const result = runAudit(projects, {
        contentPackagePaths,
        duplicateThreshold: 50,
      });

      progress.report({ message: 'Generating Excel report...' });
      const reportPath = await generateExcelReport(result, outputUri.fsPath);

      const summary = [
        `# AEM Component Audit Complete`,
        '',
        `**Projects:** ${platformSummary}`,
        `**Total Components:** ${result.summary.totalComponents}`,
        `**Classification:**`,
        `- Pure Custom: ${result.summary.byClassification.custom}`,
        `- Proxied: ${result.summary.byClassification.proxied}`,
        `- Proxied + Customized: ${result.summary.byClassification['proxied-customized']}`,
        `- Pure OOTB: ${result.summary.byClassification.ootb}`,
        `**Core Component Sling Models:**`,
        `- Core Model Overrides: ${result.summary.withCoreModelOverride}`,
        `- Using OOTB Model: ${result.summary.coreProxiesWithoutModelOverride}`,
        `**Duplicates:** ${result.summary.duplicatePairs} pair(s)`,
        `**Unused:** ${result.summary.unusedComponents}`,
        `**Recommendations:** ${result.recommendations.length}`,
        '',
        `Report saved to: ${reportPath}`,
      ];

      const doc = await vscode.workspace.openTextDocument({
        content: summary.join('\n'),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });

      vscode.window.showInformationMessage(
        `Audit report saved: ${path.basename(reportPath)}`,
        'Open Report',
      ).then((action) => {
        if (action === 'Open Report') {
          vscode.env.openExternal(vscode.Uri.file(reportPath));
        }
      });
    },
  );
}

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
