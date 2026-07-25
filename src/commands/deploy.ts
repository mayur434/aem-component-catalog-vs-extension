/**
 * Deploy the immutable code to a LOCAL AEM instance.
 *
 * STRICT SCOPE: only `core`, `ui.apps`, and `ui.config` are ever deployed —
 * never `ui.content`. `-am` builds their upstream build dependencies (e.g.
 * ui.apps.structure) but never `ui.content`, which is not an upstream dependency
 * of any of these three, so authored /content and /conf are never touched.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { requireTrustedWorkspace, selectAemCloudProject } from './projectSelection';

const DEPLOY_MODULES = ['core', 'ui.apps', 'ui.config'];

export async function deployLocalCommand(requestedRoot?: string): Promise<void> {
  if (!requireTrustedWorkspace('Deploy to local AEM')) return;
  const project = await selectAemCloudProject(requestedRoot, 'Select the project to deploy to local AEM');
  if (!project) return;
  await deployLocal(project.root);
}

export async function deployLocal(projectRoot: string): Promise<void> {
  const modules = DEPLOY_MODULES.filter((module) => fs.existsSync(path.join(projectRoot, module)));
  if (!modules.length) {
    vscode.window.showErrorMessage('None of core, ui.apps, ui.config were found in this project.');
    return;
  }
  const { host, port } = readAemTarget(projectRoot);
  const confirm = await vscode.window.showWarningMessage(
    `Deploy ${modules.join(', ')} to local AEM at ${host}:${port}?`,
    { modal: true, detail: 'Installs the OSGi bundle and immutable packages via Maven. ui.content is never deployed.' },
    'Deploy',
  );
  if (confirm !== 'Deploy') return;

  const mvn = fs.existsSync(path.join(projectRoot, 'mvnw')) ? './mvnw' : 'mvn';
  const args = [
    '-B',
    'clean',
    'install',
    '-pl',
    modules.join(','),
    '-am',
    '-PautoInstallPackage,autoInstallBundle',
  ];
  const task = new vscode.Task(
    { type: 'aem-deploy' },
    vscode.TaskScope.Workspace,
    'Deploy core, ui.apps, ui.config',
    'AEM Component Catalog',
    new vscode.ShellExecution(mvn, args, { cwd: projectRoot }),
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
    focus: false,
  };

  vscode.window.showInformationMessage(`Deploying ${modules.join(', ')} to local AEM (${host}:${port})…`);
  let execution: vscode.TaskExecution;
  try {
    execution = await vscode.tasks.executeTask(task);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not start Maven — is "${mvn}" available on your PATH? ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  const subscription = vscode.tasks.onDidEndTaskProcess((event) => {
    if (event.execution !== execution) return;
    subscription.dispose();
    if (event.exitCode === 0) {
      vscode.window.showInformationMessage(`✓ Deployed ${modules.join(', ')} to local AEM · ui.content excluded.`);
    } else {
      vscode.window.showErrorMessage(
        `✗ Local deploy failed (exit ${event.exitCode ?? 'unknown'}). See the "Deploy core, ui.apps, ui.config" terminal for details.`,
      );
    }
  });
}

function readAemTarget(projectRoot: string): { host: string; port: string } {
  try {
    const pom = fs.readFileSync(path.join(projectRoot, 'pom.xml'), 'utf-8');
    const host = pom.match(/<aem\.host>([^<]+)<\/aem\.host>/)?.[1]?.trim();
    const port = pom.match(/<aem\.port>([^<]+)<\/aem\.port>/)?.[1]?.trim();
    return { host: host || 'localhost', port: port || '4502' };
  } catch {
    return { host: 'localhost', port: '4502' };
  }
}
