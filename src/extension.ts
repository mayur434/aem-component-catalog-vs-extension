/**
 * AEM Component Catalog Enterprise — VS Code extension entry point.
 */
import * as vscode from 'vscode';
import { initCommand } from './commands/init';
import { openConfigPanel } from './webview/configPanel';
import { generateCommand } from './commands/generate';
import { deployLocalCommand } from './commands/deploy';
import { updateCommand } from './commands/update';
import { previewCommand } from './commands/preview';
import { scanCommand } from './commands/scan';
import { doctorCommand } from './commands/doctor';
import { rollbackCommand } from './commands/rollback';
import { supportBundleCommand } from './commands/support';
import { ActionsProvider, ProjectsProvider, ComponentsProvider } from './sidebar/treeProviders';
import { openDashboard } from './webview/dashboard';

export function activate(context: vscode.ExtensionContext): void {
  // Sidebar tree providers
  const actionsProvider = new ActionsProvider();
  const projectsProvider = new ProjectsProvider();
  const componentsProvider = new ComponentsProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aemCL.actions', actionsProvider),
    vscode.window.registerTreeDataProvider('aemCL.projects', projectsProvider),
    vscode.window.registerTreeDataProvider('aemCL.components', componentsProvider),
  );

  // Refresh sidebar command
  const refreshAll = () => {
    projectsProvider.refresh();
    componentsProvider.refresh();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('aemComponentLibrary.init', async (projectRoot?: string) => {
      await initCommand(projectRoot);
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.createMicrosite', () =>
      openConfigPanel(context, refreshAll),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.configure', () =>
      openConfigPanel(context, refreshAll),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.deployLocal', async (projectRoot?: string) => {
      await deployLocalCommand(projectRoot);
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.generate', async (projectRoot?: string) => {
      await generateCommand(projectRoot);
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.update', async (projectRoot?: string) => {
      await updateCommand(projectRoot);
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.preview', (projectRoot?: string) =>
      previewCommand(projectRoot),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.scan', async (projectRoot?: string) => {
      await scanCommand(projectRoot);
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.doctor', (projectRoot?: string) =>
      doctorCommand(projectRoot),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.rollback', async (projectRoot?: string) => {
      await rollbackCommand(projectRoot);
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.exportSupportBundle', (projectRoot?: string) =>
      supportBundleCommand(projectRoot),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.refreshSidebar', refreshAll),
    vscode.commands.registerCommand('aemComponentLibrary.openDashboard', () =>
      openDashboard(context, refreshAll),
    ),
  );

  // Status bar item
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(layers) AEM CL';
  statusItem.tooltip = 'AEM Component Catalog Enterprise';
  statusItem.command = 'aemComponentLibrary.openDashboard';
  statusItem.show();
  context.subscriptions.push(statusItem);
}

export function deactivate(): void {
  // cleanup
}
