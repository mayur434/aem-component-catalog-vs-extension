/**
 * AEM Component Catalog — VS Code extension entry point.
 */
import * as vscode from 'vscode';
import { openConfigPanel } from './webview/configPanel';
import { generateCommand } from './commands/generate';
import { deployLocalCommand } from './commands/deploy';
import { previewCommand } from './commands/preview';
import { scanCommand } from './commands/scan';
import { doctorCommand } from './commands/doctor';
import { rollbackCommand } from './commands/rollback';
import { supportBundleCommand } from './commands/support';
import { ActionsProvider, ProjectsProvider, ComponentsProvider } from './sidebar/treeProviders';
import { openDashboard } from './webview/dashboard';
import { openAuditPanel } from './webview/auditPanel';
import { discoverWorkspaceProjects } from './commands/projectSelection';

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
    vscode.commands.registerCommand('aemComponentLibrary.audit', () =>
      openAuditPanel(context),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.refreshSidebar', refreshAll),
    vscode.commands.registerCommand('aemComponentLibrary.openDashboard', () =>
      openDashboard(context, refreshAll),
    ),
  );

  // Auto-refresh sidebar when workspace folders change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshAll()),
  );

  // Status bar — only visible when AEM projects are detected
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(layers) AEM CL';
  statusItem.tooltip = 'AEM Component Catalog';
  statusItem.command = 'aemComponentLibrary.openDashboard';
  context.subscriptions.push(statusItem);

  const updateStatusBar = () => {
    const projects = discoverWorkspaceProjects();
    if (projects.length > 0) {
      statusItem.show();
    } else {
      statusItem.hide();
    }
  };
  updateStatusBar();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar()),
  );
}

export function deactivate(): void {
  // cleanup
}
