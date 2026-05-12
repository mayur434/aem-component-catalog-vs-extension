/**
 * Init command — detect project, prompt for config, create .component-library.json
 */
import * as vscode from 'vscode';
import { detectProject, detectAllProjects, ProjectInfo } from '../scanner/projectDetector';
import { scanComponents } from '../scanner/componentScanner';
import { configExists, saveConfig } from '../config/loader';
import { getDefaults } from '../config/defaults';

export async function initCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const wsRoot = workspaceFolders[0].uri.fsPath;

  // Detect all AEM projects
  const projects = detectAllProjects(wsRoot);
  if (projects.length === 0) {
    vscode.window.showErrorMessage('No AEM project (reactor POM with modules) found in workspace.');
    return;
  }

  // Let user pick if multiple projects
  let project: ProjectInfo;
  if (projects.length === 1) {
    project = projects[0];
  } else {
    const pick = await vscode.window.showQuickPick(
      projects.map(p => ({
        label: p.artifactId,
        description: `${p.root} (${p.projectType === 'cloud' ? 'AEMaaCS' : 'AEM AMS'})`,
        detail: `${p.modules.length} modules · ${p.groupId}:${p.version}`,
        project: p,
      })),
      { placeHolder: 'Select the AEM project to generate a Component Library for' }
    );
    if (!pick) { return; }
    project = (pick as any).project;
  }

  // Check if config already exists
  if (configExists(project.root)) {
    const overwrite = await vscode.window.showWarningMessage(
      '.component-library.json already exists. Overwrite?',
      'Yes', 'No'
    );
    if (overwrite !== 'Yes') { return; }
  }

  // Prompt for brand colors
  const primary = await vscode.window.showInputBox({
    prompt: 'Primary brand color (hex)',
    value: '#03438E',
    placeHolder: '#03438E',
  });
  if (primary === undefined) { return; }

  const accent = await vscode.window.showInputBox({
    prompt: 'Accent color (hex)',
    value: '#4CADE9',
    placeHolder: '#4CADE9',
  });
  if (accent === undefined) { return; }

  const font = await vscode.window.showInputBox({
    prompt: 'Primary font family',
    value: 'Roboto, sans-serif',
    placeHolder: 'Roboto, sans-serif',
  });
  if (font === undefined) { return; }

  const pageTitle = await vscode.window.showInputBox({
    prompt: 'Page title for the Component Library',
    value: 'Component Library',
  });
  if (pageTitle === undefined) { return; }

  // Build config
  const defaults = getDefaults(project.artifactId);
  const config: Record<string, any> = {
    appId: project.artifactId,
    projectType: project.projectType,
    brand: {
      ...defaults.brand,
      primary,
      accent,
      font: font.split(',')[0].trim(),
      fontFallback: font,
    },
    components: defaults.components,
    features: defaults.features,
    output: {
      ...defaults.output,
      servletPackage: project.javaPackage,
      pageTitle: pageTitle || 'Component Library',
    },
    serviceUser: defaults.serviceUser,
    hero: {
      ...defaults.hero,
      badge: project.artifactId,
      titlePrefix: project.artifactId,
    },
  };

  saveConfig(project.root, config);

  // Scan components for a summary
  const scan = scanComponents(project.root, defaults);
  const typeLabel = project.projectType === 'cloud' ? 'AEMaaCS' : 'AEM AMS';
  const msg = `✓ Created .component-library.json for "${project.artifactId}" (${typeLabel}) — ` +
    `${scan.total} components found in ${Object.keys(scan.groups).length} groups. ` +
    `Run "AEM Component Library: Generate" to create all files.`;

  vscode.window.showInformationMessage(msg);

  // Open the config file
  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.file(`${project.root}/.component-library.json`)
  );
  await vscode.window.showTextDocument(doc);
}
