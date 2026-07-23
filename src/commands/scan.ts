import * as vscode from 'vscode';
import { loadConfig } from '../config/loader';
import { scanComponents } from '../scanner/componentScanner';
import { selectAemCloudProject } from './projectSelection';

export async function scanCommand(requestedRoot?: string): Promise<void> {
  const project = await selectAemCloudProject(requestedRoot, 'Select the AEMaaCS project to scan');
  if (!project) return;
  try {
    const result = scanComponents(project.root, loadConfig(project.root));
    const lines = [
      `# Component Governance Report — ${project.artifactId}`,
      '',
      `- Components: ${result.total}`,
      `- Groups: ${Object.keys(result.groups).length}`,
      `- Average quality: ${result.averageQualityScore}/100`,
      '',
      '| Score | Status | Owner | Dialog fields | Model/Exporter | Usages | Component | Missing |',
      '|---:|---|---|---:|---|---:|---|---|',
      ...result.components.map(
        (component) =>
          `| ${component.quality.score} (${component.quality.grade}) | ${escapeCell(component.status || 'unset')} | ${escapeCell(component.owner || 'unowned')} | ${component.dialogFields.length} | ${escapeCell(component.modelClass ? `${component.modelClass}${component.exporter ? ' ✓' : ''}` : '—')} | ${component.usageCount} | \`${component.resourceType}\` | ${escapeCell(component.quality.missing.join(', ') || '—')} |`,
      ),
      '',
      '## Groups',
      '',
      ...Object.entries(result.groups)
        .sort((left, right) => right[1] - left[1])
        .map(([group, count]) => `- ${group}: ${count}`),
    ];
    const document = await vscode.workspace.openTextDocument({
      content: lines.join('\n'),
      language: 'markdown',
    });
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) {
    vscode.window.showErrorMessage(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
