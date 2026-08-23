import * as vscode from 'vscode';
import { formatDoctorReport, runDoctor } from '../core/doctor';
import { doctorReportToSarif } from '../core/sarif';
import { selectAemProject } from './projectSelection';

export async function doctorCommand(requestedRoot?: string): Promise<void> {
  const project = await selectAemProject(requestedRoot, 'Select the AEM project to validate');
  if (!project) return;
  const policyFile = vscode.workspace
    .getConfiguration('aemComponentLibrary', vscode.Uri.file(project.root))
    .get<string>('policyFile', '.aem-catalog-policy.json');
  const includeInformation = vscode.workspace
    .getConfiguration('aemComponentLibrary', vscode.Uri.file(project.root))
    .get<boolean>('showInformationFindings', true);
  const report = runDoctor(project.root, { policyFile });
  const document = await vscode.workspace.openTextDocument({
    content: formatDoctorReport(report, includeInformation),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(document, { preview: true });
  const action = await vscode.window.showInformationMessage(
    `AEM Cloud Doctor ${report.summary.passed ? 'passed' : 'failed'} · ${report.summary.errors} errors · ${report.summary.warnings} warnings.`,
    'Export SARIF',
  );
  if (action === 'Export SARIF') {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(vscode.Uri.file(project.root), 'aem-cloud-doctor.sarif'),
      filters: { SARIF: ['sarif', 'json'] },
    });
    if (target) {
      await vscode.workspace.fs.writeFile(
        target,
        Buffer.from(`${JSON.stringify(doctorReportToSarif(report), null, 2)}\n`, 'utf-8'),
      );
    }
  }
}
