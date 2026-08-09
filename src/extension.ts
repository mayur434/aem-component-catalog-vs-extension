/**
 * AEM Component Catalog — VS Code extension entry point.
 */
import * as vscode from 'vscode';
import { openCatalogPanel } from './webview/catalogPanel';
import { generateCommand } from './commands/generate';
import { deployLocalCommand } from './commands/deploy';
import { previewCommand } from './commands/preview';
import { scanCommand } from './commands/scan';
import { doctorCommand } from './commands/doctor';
import { rollbackCommand } from './commands/rollback';
import { supportBundleCommand } from './commands/support';
import { ProjectsProvider, ComponentsProvider } from './sidebar/treeProviders';
import { discoverWorkspaceProjects } from './commands/projectSelection';

/** Context-menu commands on a project row receive the tree item itself, not a bare string — normalize both invocation styles. */
function rootOf(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'projectRoot' in arg) {
    const value = (arg as { projectRoot?: unknown }).projectRoot;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  // Sidebar tree providers — pure navigation (Projects, Components); actions
  // live in the unified Catalog panel and in project right-click menus.
  const projectsProvider = new ProjectsProvider();
  const componentsProvider = new ComponentsProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('aemCL.projects', projectsProvider),
    vscode.window.registerTreeDataProvider('aemCL.components', componentsProvider),
  );

  // Refresh sidebar command
  const refreshAll = () => {
    projectsProvider.refresh();
    componentsProvider.refresh();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('aemComponentLibrary.openCatalog', (arg?: unknown) =>
      openCatalogPanel(context, { tab: 'overview', projectRoot: rootOf(arg) }, refreshAll),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.configure', (arg?: unknown) =>
      openCatalogPanel(context, { tab: 'configure', projectRoot: rootOf(arg) }, refreshAll),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.audit', (arg?: unknown) =>
      openCatalogPanel(context, { tab: 'audit', projectRoot: rootOf(arg) }, refreshAll),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.deployLocal', async (arg?: unknown) => {
      await deployLocalCommand(rootOf(arg));
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.generate', async (arg?: unknown) => {
      await generateCommand(rootOf(arg));
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.preview', (arg?: unknown) =>
      previewCommand(rootOf(arg)),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.scan', async (arg?: unknown) => {
      await scanCommand(rootOf(arg));
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.doctor', (arg?: unknown) =>
      doctorCommand(rootOf(arg)),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.rollback', async (arg?: unknown) => {
      await rollbackCommand(rootOf(arg));
      refreshAll();
    }),
    vscode.commands.registerCommand('aemComponentLibrary.exportSupportBundle', (arg?: unknown) =>
      supportBundleCommand(rootOf(arg)),
    ),
    vscode.commands.registerCommand('aemComponentLibrary.refreshSidebar', refreshAll),
  );

  // Auto-refresh sidebar when workspace folders change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshAll()),
  );

  // Status bar — only visible when AEM projects are detected
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(layers) AEM CL';
  statusItem.tooltip = 'AEM Component Catalog';
  statusItem.command = 'aemComponentLibrary.openCatalog';
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
