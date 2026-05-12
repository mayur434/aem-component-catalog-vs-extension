/**
 * AEM Component Library Generator — VS Code Extension Entry Point
 */
import * as vscode from 'vscode';
import { initCommand } from './commands/init';
import { generateCommand } from './commands/generate';
import { updateCommand } from './commands/update';
import { previewCommand } from './commands/preview';
import { scanCommand } from './commands/scan';
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
    vscode.commands.registerCommand('aemComponentLibrary.init', async () => {
      await initCommand();
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.generate', async () => {
      await generateCommand();
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.update', async () => {
      await updateCommand();
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.preview', previewCommand),
    vscode.commands.registerCommand('aemComponentLibrary.scan', async () => {
      await scanCommand();
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.refreshSidebar', refreshAll),
    vscode.commands.registerCommand('aemComponentLibrary.openDashboard', () => openDashboard(context, refreshAll)),
  );

  // Status bar item
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(layers) AEM CL';
  statusItem.tooltip = 'AEM Component Library Generator';
  statusItem.command = 'aemComponentLibrary.openDashboard';
  statusItem.show();
  context.subscriptions.push(statusItem);
}

export function deactivate(): void {
  // cleanup
}
