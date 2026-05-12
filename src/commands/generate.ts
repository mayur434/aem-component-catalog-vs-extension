/**
 * Generate command — full generation of all component library files.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { detectAllProjects, ProjectInfo } from '../scanner/projectDetector';
import { loadConfig, configExists, validateConfig } from '../config/loader';
import { resolveAemPaths } from '../utils/aemPaths';
import { hashContent, WriteResult } from '../utils/fileOps';
import { createManifest, saveManifest, loadManifest } from '../utils/manifest';
import { generateServlet } from '../generators/servletGenerator';
import { generatePageComponent } from '../generators/pageComponentGenerator';
import { generateClientlib } from '../generators/clientlibGenerator';
import { generateOsgiConfigs } from '../generators/osgiConfigGenerator';
import { generateContent } from '../generators/contentGenerator';

export async function generateCommand(): Promise<void> {
  const project = await resolveProject();
  if (!project) { return; }
  const projectRoot = project.root;

  // Validate config exists
  if (!configExists(projectRoot)) {
    const choice = await vscode.window.showWarningMessage(
      'No .component-library.json found in this project. You need to initialize the config first.',
      'Run Init',
      'Cancel',
    );
    if (choice === 'Run Init') {
      await vscode.commands.executeCommand('aemComponentLibrary.init');
    }
    return;
  }

  // Load and validate config
  let config;
  try {
    config = loadConfig(projectRoot);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Config error: ${err.message}`, 'Open Config').then(choice => {
      if (choice === 'Open Config') {
        vscode.workspace.openTextDocument(vscode.Uri.file(`${projectRoot}/.component-library.json`))
          .then(doc => vscode.window.showTextDocument(doc));
      }
    });
    return;
  }

  // Inject detected project type if not already set in config
  if (!config.projectType) {
    config.projectType = project.projectType;
  }

  const isAms = config.projectType === 'ams';

  // Validate required AEM modules exist (type-aware)
  const requiredModules = ['core', 'ui.apps'];
  if (!isAms) {
    // AEMaaCS requires ui.config for RepoInit / OSGi configs
    requiredModules.push('ui.config');
  }
  const missingModules: string[] = [];
  for (const mod of requiredModules) {
    if (!fs.existsSync(`${projectRoot}/${mod}`)) {
      missingModules.push(mod);
    }
  }
  if (missingModules.length > 0) {
    vscode.window.showErrorMessage(
      `Required AEM modules not found: ${missingModules.join(', ')}. ` +
      `Ensure you have a standard AEM project structure.`
    );
    return;
  }

  // Validate resolved paths
  let paths;
  try {
    paths = resolveAemPaths(projectRoot);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Project structure error: ${err.message}`);
    return;
  }

  // Check if already generated — warn about overwrite
  const existingManifest = loadManifest(projectRoot);
  if (existingManifest && Object.keys(existingManifest.files).length > 0) {
    const existing = Object.keys(existingManifest.files).length;
    const confirm = await vscode.window.showWarningMessage(
      `${existing} files were previously generated (${existingManifest.generatedAt.split('T')[0]}). Re-generating will overwrite them.`,
      'Continue',
      'Cancel',
    );
    if (confirm !== 'Continue') { return; }
  }

  try {
    const manifest = createManifest(hashContent(JSON.stringify(config)));

    const allResults: WriteResult[] = [];

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating Component Library',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Generating servlet...' });
        allResults.push(generateServlet(config, paths, manifest));

        progress.report({ message: 'Generating page component...' });
        allResults.push(...generatePageComponent(config, paths, manifest));

        progress.report({ message: 'Generating clientlib...' });
        allResults.push(...generateClientlib(config, paths, manifest));

        progress.report({ message: 'Generating OSGi configs...' });
        allResults.push(...generateOsgiConfigs(config, paths, manifest));

        progress.report({ message: 'Generating content page...' });
        allResults.push(...generateContent(config, paths, manifest));

        progress.report({ message: 'Saving manifest...' });
        saveManifest(projectRoot, manifest);
      }
    );

    const created = allResults.filter(r => r.action === 'created').length;
    const updated = allResults.filter(r => r.action === 'updated').length;
    const skipped = allResults.filter(r => r.action === 'skipped').length;

    const msg = `Component Library generated — ${created} created, ${updated} updated, ${skipped} skipped.`;
    const deployCmd = 'mvn clean install -PautoInstallSinglePackage -DskipTests';

    vscode.window.showInformationMessage(msg, 'Show Files', 'Copy Deploy Command').then(choice => {
      if (choice === 'Show Files') {
        showGeneratedFiles(allResults);
      } else if (choice === 'Copy Deploy Command') {
        vscode.env.clipboard.writeText(deployCmd);
        vscode.window.showInformationMessage('Deploy command copied to clipboard.');
      }
    });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Generation failed: ${err.message}`);
  }
}

async function resolveProject(): Promise<ProjectInfo | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return undefined;
  }

  const wsRoot = workspaceFolders[0].uri.fsPath;
  const projects = detectAllProjects(wsRoot);

  // Check each project for .component-library.json
  const configured = projects.filter(p => {
    try {
      loadConfig(p.root);
      return true;
    } catch {
      return false;
    }
  });

  if (configured.length === 0) {
    vscode.window.showErrorMessage('No .component-library.json found. Run "AEM Component Library: Init" first.');
    return undefined;
  }

  if (configured.length === 1) {
    return configured[0];
  }

  const pick = await vscode.window.showQuickPick(
    configured.map(p => ({
      label: p.artifactId,
      description: `${p.root} (${p.projectType === 'cloud' ? 'AEMaaCS' : 'AEM AMS'})`,
      project: p,
    })),
    { placeHolder: 'Select the AEM project' }
  );

  return pick ? (pick as any).project : undefined;
}

async function showGeneratedFiles(results: WriteResult[]): Promise<void> {
  const items = results.map(r => ({
    label: `${r.action === 'created' ? '$(add)' : r.action === 'updated' ? '$(edit)' : '$(circle-slash)'} ${r.file.split('/').pop()}`,
    description: r.action,
    detail: r.file,
    file: r.file,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a file to open',
  });

  if (pick) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pick.file));
    await vscode.window.showTextDocument(doc);
  }
}
