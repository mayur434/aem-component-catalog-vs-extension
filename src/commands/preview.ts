/**
 * Preview command — dry-run showing what files would be created/modified.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { detectAllProjects } from '../scanner/projectDetector';
import { loadConfig } from '../config/loader';
import { resolveAemPaths } from '../utils/aemPaths';
import * as path from 'path';

export async function previewCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const wsRoot = workspaceFolders[0].uri.fsPath;
  const projects = detectAllProjects(wsRoot);

  let projectRoot: string | undefined;
  let detectedType: 'cloud' | 'ams' = 'cloud';
  for (const p of projects) {
    try {
      loadConfig(p.root);
      projectRoot = p.root;
      detectedType = p.projectType;
      break;
    } catch { /* skip */ }
  }

  if (!projectRoot) {
    const choice = await vscode.window.showWarningMessage(
      'No .component-library.json found. You need to initialize the config first.',
      'Run Init',
      'Cancel',
    );
    if (choice === 'Run Init') {
      await vscode.commands.executeCommand('aemComponentLibrary.init');
    }
    return;
  }

  let config;
  let paths;
  try {
    config = loadConfig(projectRoot);
    if (!config.projectType) {
      config.projectType = detectedType;
    }
    paths = resolveAemPaths(projectRoot);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Config error: ${err.message}`);
    return;
  }

  const isAms = config.projectType === 'ams';
  const files: Array<{ path: string; exists: boolean; module: string }> = [];
  const relPath = (abs: string) => path.relative(projectRoot!, abs);

  // Servlet
  const servletPath = paths.servletFile(config);
  files.push({ path: relPath(servletPath), exists: fs.existsSync(servletPath), module: 'core' });

  // Page component
  const pageDir = paths.pageComponentDir(config);
  for (const f of ['.content.xml', 'body.html', 'customheaderlibs.html', 'customfooterlibs.html']) {
    const fp = path.join(pageDir, f);
    files.push({ path: relPath(fp), exists: fs.existsSync(fp), module: 'ui.apps' });
  }

  // Clientlib
  const clDir = paths.clientlibDir(config);
  for (const f of ['.content.xml', 'js.txt', 'css.txt', 'js/scripts.js', 'css/styles.css']) {
    const fp = path.join(clDir, f);
    files.push({ path: relPath(fp), exists: fs.existsSync(fp), module: 'ui.apps' });
  }

  // OSGi configs
  const osgiDir = paths.osgiConfigDir(config);
  const osgiModule = paths.hasUiConfig ? 'ui.config' : 'ui.apps';
  for (const f of [
    `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended~${config.appId}.cfg.json`,
    `org.apache.sling.jcr.repoinit.RepositoryInitializer~${config.appId}.cfg.json`,
  ]) {
    const fp = path.join(osgiDir, f);
    files.push({ path: relPath(fp), exists: fs.existsSync(fp), module: osgiModule });
  }

  // Content page — only a file on AMS (Cloud uses RepoInit)
  if (isAms) {
    const contentDir = paths.contentDir(config);
    const fp = path.join(contentDir, '.content.xml');
    files.push({ path: relPath(fp), exists: fs.existsSync(fp), module: 'ui.content' });
  }

  // Build output
  let output = `# AEM Component Library — Preview\n\n`;
  output += `**Project:** ${config.appId}\n`;
  output += `**Project Type:** ${isAms ? 'AEM AMS (6.x)' : 'AEMaaCS (Cloud)'}\n`;
  output += `**Content Path:** ${config.output.contentPath}\n`;
  output += `**Content Strategy:** ${isAms ? 'File in ui.content' : 'RepoInit in ui.config'}\n`;
  output += `**Servlet Package:** ${config.output.servletPackage}\n`;
  output += `**Clientlib Category:** ${config.output.clientlibCategory}\n\n`;
  output += `## Files (${files.length})\n\n`;
  output += `| Status | Module | File |\n`;
  output += `|--------|--------|------|\n`;

  for (const f of files) {
    const status = f.exists ? '⚡ Update' : '✨ Create';
    output += `| ${status} | ${f.module} | ${f.path} |\n`;
  }

  output += `\n## Next Steps\n\n`;
  output += `1. Run **"AEM Component Library: Generate"** to create all files\n`;
  output += `2. Build: \`mvn clean install -PautoInstallSinglePackage -DskipTests\`\n`;
  output += `3. Open: \`${config.output.contentPath}.html\`\n`;

  // Show in an untitled document
  const doc = await vscode.workspace.openTextDocument({
    content: output,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}
