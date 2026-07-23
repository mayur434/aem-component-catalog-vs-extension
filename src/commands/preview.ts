import * as vscode from 'vscode';
import { loadConfig } from '../config/loader';
import { buildGenerationPlan, formatPlan } from '../core/generation';
import { selectAemCloudProject } from './projectSelection';

export async function previewCommand(requestedRoot?: string): Promise<void> {
  const project = await selectAemCloudProject(requestedRoot, 'Select the AEMaaCS project to preview');
  if (!project) return;
  try {
    const plan = buildGenerationPlan(project.root, loadConfig(project.root));
    let output = `# Generation Plan\n\n\`\`\`text\n${formatPlan(plan)}\n\`\`\`\n\n`;
    const changed = plan.items.filter((item) => item.status !== 'unchanged');
    for (const item of changed) {
      output += `## ${item.status.toUpperCase()} — \`${item.relativePath}\`\n\n`;
      if (item.reason) output += `${item.reason}\n\n`;
      if (item.diff) output += `\`\`\`diff\n${item.diff}\n\`\`\`\n\n`;
    }
    if (!changed.length) output += '\nAll generated artifacts are up to date.\n';
    const document = await vscode.workspace.openTextDocument({ content: output, language: 'markdown' });
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Preview failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
