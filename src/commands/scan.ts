/**
 * Scan command — scan local workspace components and show a report.
 */
import * as vscode from 'vscode';
import { detectAllProjects } from '../scanner/projectDetector';
import { scanComponents } from '../scanner/componentScanner';
import { loadConfig, configExists } from '../config/loader';
import { getDefaults } from '../config/defaults';

export async function scanCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const wsRoot = workspaceFolders[0].uri.fsPath;
  const projects = detectAllProjects(wsRoot);

  if (projects.length === 0) {
    vscode.window.showErrorMessage('No AEM project found in workspace.');
    return;
  }

  // Pick project if multiple
  let project = projects[0];
  if (projects.length > 1) {
    const pick = await vscode.window.showQuickPick(
      projects.map(p => ({ label: p.artifactId, description: p.root, project: p })),
      { placeHolder: 'Select the AEM project to scan' }
    );
    if (!pick) { return; }
    project = (pick as any).project;
  }

  // Load config or use defaults
  const config = configExists(project.root)
    ? loadConfig(project.root)
    : getDefaults(project.artifactId);

  const result = scanComponents(project.root, config);

  // Build report
  let output = `# Component Scan Report — ${project.artifactId}\n\n`;
  output += `**Total Components:** ${result.total}\n`;
  output += `**Groups:** ${Object.keys(result.groups).length}\n\n`;

  // Groups table
  output += `## Groups\n\n`;
  output += `| Group | Count |\n`;
  output += `|-------|-------|\n`;
  for (const [group, count] of Object.entries(result.groups)) {
    output += `| ${group} | ${count} |\n`;
  }

  // Components table
  output += `\n## Components\n\n`;
  output += `| Component | Group | Dialog | README | Thumbnail | Layouts |\n`;
  output += `|-----------|-------|--------|--------|-----------|--------|\n`;
  for (const comp of result.components) {
    output += `| ${comp.title} | ${comp.group.replace(/.*-\s*/, '')} `;
    output += `| ${comp.hasDialog ? '✅' : '—'} `;
    output += `| ${comp.hasReadme ? '✅' : '—'} `;
    output += `| ${comp.hasThumbnail ? '✅' : '—'} `;
    output += `| ${comp.layoutFiles.length > 0 ? comp.layoutFiles.length + ' files' : '—'} |\n`;
  }

  output += `\n## Coverage Summary\n\n`;
  const withDialog = result.components.filter(c => c.hasDialog).length;
  const withReadme = result.components.filter(c => c.hasReadme).length;
  const withThumb = result.components.filter(c => c.hasThumbnail).length;
  const withLayouts = result.components.filter(c => c.layoutFiles.length > 0).length;

  output += `- **Dialog:** ${withDialog}/${result.total} (${pct(withDialog, result.total)})\n`;
  output += `- **README:** ${withReadme}/${result.total} (${pct(withReadme, result.total)})\n`;
  output += `- **Thumbnail:** ${withThumb}/${result.total} (${pct(withThumb, result.total)})\n`;
  output += `- **Layouts:** ${withLayouts}/${result.total} (${pct(withLayouts, result.total)})\n`;

  const doc = await vscode.workspace.openTextDocument({
    content: output,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

function pct(n: number, total: number): string {
  if (total === 0) { return '0%'; }
  return Math.round((n / total) * 100) + '%';
}
