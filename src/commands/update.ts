/**
 * Update command — re-generate only files that haven't been manually modified.
 */
import * as vscode from 'vscode';
import { detectAllProjects } from '../scanner/projectDetector';
import { loadConfig, configExists } from '../config/loader';
import { resolveAemPaths } from '../utils/aemPaths';
import { hashContent, writeFileManifestAware, WriteResult } from '../utils/fileOps';
import { loadManifest, createManifest, saveManifest, addToManifest } from '../utils/manifest';
import { renderTemplate } from '../utils/templateEngine';

export async function updateCommand(): Promise<void> {
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

  let projectRoot: string | undefined;
  const configured = projects.filter(p => configExists(p.root));

  if (configured.length === 0) {
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

  if (configured.length === 1) {
    projectRoot = configured[0].root;
  } else {
    const pick = await vscode.window.showQuickPick(
      configured.map(p => ({
        label: p.artifactId,
        description: `${p.root} (${p.projectType === 'cloud' ? 'AEMaaCS' : 'AEM AMS'})`,
        root: p.root,
      })),
      { placeHolder: 'Select the AEM project to update' }
    );
    if (!pick) { return; }
    projectRoot = (pick as any).root;
  }

  if (!projectRoot) { return; }

  // Check manifest exists
  const oldManifest = loadManifest(projectRoot);
  if (!oldManifest) {
    const choice = await vscode.window.showWarningMessage(
      'No previous generation found. Run "Generate" first to create all files, then use "Update" for incremental changes.',
      'Run Generate',
      'Cancel',
    );
    if (choice === 'Run Generate') {
      await vscode.commands.executeCommand('aemComponentLibrary.generate');
    }
    return;
  }

  try {
    const config = loadConfig(projectRoot);
    // Inject detected project type if not explicitly set
    if (!config.projectType) {
      const matchedProject = configured.find(p => p.root === projectRoot);
      if (matchedProject) {
        config.projectType = matchedProject.projectType;
      }
    }
    const paths = resolveAemPaths(projectRoot);
    const newManifest = createManifest(hashContent(JSON.stringify(config)));
    const results: WriteResult[] = [];

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating Component Library',
        cancellable: false,
      },
      async (progress) => {
        // Re-generate each template file, checking manifest for manual changes
        const templateFiles: Array<{ template: string; outputPath: string; context: Record<string, any> }> = [
          {
            template: 'ComponentLibraryServlet.java.hbs',
            outputPath: paths.servletFile(config),
            context: {
              package: config.output.servletPackage,
              appId: config.appId,
              componentRoot: config.components.root,
              resourceType: config.output.pageResourceType,
              subServiceName: config.serviceUser.subServiceName,
              excludedGroups: config.components.groups.exclude,
              thumbnailFileNames: config.components.thumbnails.fileNames,
              layoutFolderName: config.components.layouts.folderName,
              layoutExclude: config.components.layouts.exclude,
            },
          },
          {
            template: 'body.html.hbs',
            outputPath: require('path').join(paths.pageComponentDir(config), 'body.html'),
            context: { appId: config.appId, hero: config.hero, features: config.features },
          },
          {
            template: 'scripts.js.hbs',
            outputPath: require('path').join(paths.clientlibDir(config), 'js', 'scripts.js'),
            context: { appId: config.appId, features: config.features, components: config.components, hero: config.hero },
          },
          {
            template: 'styles.css.hbs',
            outputPath: require('path').join(paths.clientlibDir(config), 'css', 'styles.css'),
            context: { brand: config.brand, features: config.features },
          },
        ];

        for (const tf of templateFiles) {
          progress.report({ message: `Updating ${tf.template.replace('.hbs', '')}...` });
          const content = renderTemplate(tf.template, tf.context);
          const manifestHash = oldManifest?.files[tf.outputPath]?.hash;
          const result = writeFileManifestAware(tf.outputPath, content, manifestHash);
          results.push(result);
          if (result.action !== 'skipped') {
            addToManifest(newManifest, tf.outputPath, content);
          } else if (oldManifest?.files[tf.outputPath]) {
            // Preserve old manifest entry for skipped files
            newManifest.files[tf.outputPath] = oldManifest.files[tf.outputPath];
          }
        }

        progress.report({ message: 'Saving manifest...' });
        saveManifest(projectRoot!, newManifest);
      }
    );

    const updated = results.filter(r => r.action === 'updated').length;
    const skipped = results.filter(r => r.action === 'skipped').length;

    let msg = `✓ Update complete — ${updated} files updated`;
    if (skipped > 0) {
      msg += `, ${skipped} skipped (manually modified)`;
      const skippedFiles = results.filter(r => r.action === 'skipped').map(r => r.file.split('/').pop()).join(', ');
      msg += `: ${skippedFiles}`;
    }

    vscode.window.showInformationMessage(msg);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Update failed: ${err.message}`);
  }
}
