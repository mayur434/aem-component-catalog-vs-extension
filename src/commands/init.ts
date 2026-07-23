import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { configExists, saveConfig } from '../config/loader';
import { getDefaults } from '../config/defaults';
import { scanComponents } from '../scanner/componentScanner';
import { requireTrustedWorkspace, selectAemCloudProject } from './projectSelection';
import { defaultPolicy } from '../core/policy';

export async function initCommand(requestedRoot?: string): Promise<void> {
  if (!requireTrustedWorkspace('Initialize configuration')) return;
  const project = await selectAemCloudProject(requestedRoot);
  if (!project) return;

  if (configExists(project.root)) {
    const choice = await vscode.window.showWarningMessage(
      '.component-library.json already exists. Replace it with v2 enterprise defaults?',
      { modal: true },
      'Replace',
    );
    if (choice !== 'Replace') return;
  }

  const primary = await input('Primary brand color', '#03438E', validateColor);
  if (primary === undefined) return;
  const accent = await input('Accent brand color', '#4CADE9', validateColor);
  if (accent === undefined) return;
  const pageTitle = await input('Component catalog page title', 'Component Catalog', (value) =>
    value.trim() ? undefined : 'A page title is required.',
  );
  if (pageTitle === undefined) return;

  const config = getDefaults(project.artifactId);
  config.brand.primary = primary;
  config.brand.accent = accent;
  config.output.servletPackage = project.javaPackage;
  config.output.pageTitle = pageTitle;
  config.hero.badge = project.artifactId;
  config.hero.titlePrefix = project.artifactId;
  saveConfig(project.root, config);
  const policyFile = path.join(project.root, config.governance.policyFile);
  if (!fs.existsSync(policyFile)) {
    fs.writeFileSync(policyFile, `${JSON.stringify(defaultPolicy(), null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o644,
    });
  }

  const scan = scanComponents(project.root, config);
  vscode.window.showInformationMessage(
    `Created AEMaaCS enterprise catalog configuration · ${scan.total} components · quality ${scan.averageQualityScore}/100.`,
  );
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(vscode.Uri.file(project.root), '.component-library.json'),
  );
  await vscode.window.showTextDocument(document);
}

async function input(
  prompt: string,
  value: string,
  validateInput: (value: string) => string | undefined,
): Promise<string | undefined> {
  return vscode.window.showInputBox({ prompt, value, validateInput, ignoreFocusOut: true });
}

function validateColor(value: string): string | undefined {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? undefined : 'Use a six-digit hexadecimal color such as #03438E.';
}
