/**
 * Sidebar tree data providers for the AEM Component Library activity bar.
 */
import * as vscode from 'vscode';
import type { ProjectInfo } from '../scanner/projectDetector';
import { scanComponents, type ScannedComponent, type ScanResult } from '../scanner/componentScanner';
import { configExists, loadConfig } from '../config/loader';
import { getDefaults } from '../config/defaults';
import { discoverWorkspaceProjects } from '../commands/projectSelection';

// ─── Actions Tree ────────────────────────────────────────────────

type ActionTreeItem = ActionItem | SeparatorItem;

export class ActionsProvider implements vscode.TreeDataProvider<ActionTreeItem> {
  getTreeItem(element: ActionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ActionTreeItem[] {
    return [
      new ActionItem('Configure & Generate Micro-site', 'aemComponentLibrary.configure', '$(rocket)'),
      new ActionItem('Generate (no prompts)', 'aemComponentLibrary.generate', '$(play)'),
      new ActionItem('Deploy to Local AEM', 'aemComponentLibrary.deployLocal', '$(cloud-upload)'),
      new ActionItem('Preview Changes', 'aemComponentLibrary.preview', '$(eye)'),
      new ActionItem('Roll Back Last Generation', 'aemComponentLibrary.rollback', '$(history)'),
      new SeparatorItem('Tech Audit'),
      new ActionItem('Run Component Audit', 'aemComponentLibrary.audit', '$(checklist)'),
    ];
  }
}

class ActionItem extends vscode.TreeItem {
  constructor(label: string, commandId: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = { command: commandId, title: label };
    this.iconPath = new vscode.ThemeIcon(icon.replace('$(', '').replace(')', ''));
  }
}

class SeparatorItem extends vscode.TreeItem {
  constructor(label: string) {
    super(`── ${label} ──`, vscode.TreeItemCollapsibleState.None);
    this.description = '';
    this.iconPath = new vscode.ThemeIcon('dash');
  }
}

// ─── Projects Tree ───────────────────────────────────────────────

export class ProjectsProvider implements vscode.TreeDataProvider<ProjectItem> {
  private _onDidChange = new vscode.EventEmitter<ProjectItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: ProjectItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ProjectItem): ProjectItem[] {
    if (element) {
      return element.children || [];
    }

    if (!vscode.workspace.workspaceFolders?.length) {
      return [new ProjectItem('No workspace open', '', 'warning')];
    }

    const projects = discoverWorkspaceProjects();
    if (projects.length === 0) {
      return [new ProjectItem('No AEM projects found', '', 'warning')];
    }

    return projects.map((p) => {
      const hasConfig = configExists(p.root);
      const platformLabel = p.platform === 'aemaacs' ? 'AEMaaCS' : 'AEM AMS';
      const item = new ProjectItem(p.artifactId, p.root, hasConfig ? 'pass' : 'circle-large-outline');
      item.description = `${platformLabel} · ${hasConfig ? 'configured' : 'not configured'}`;
      item.tooltip = `${p.groupId}:${p.artifactId}:${p.version}\nPlatform: ${platformLabel}\n${p.root}\nModules: ${p.modules.join(', ')}`;
      item.children = [
        new ProjectItem(`Platform: ${platformLabel}`, '', 'vm'),
        new ProjectItem(`Group: ${p.groupId}`, '', 'tag'),
        new ProjectItem(`Version: ${p.version}`, '', 'versions'),
        new ProjectItem(`Modules: ${p.modules.length}`, '', 'files'),
        new ProjectItem(`Java: ${p.javaPackage}`, '', 'symbol-namespace'),
        new ProjectItem(`Config: ${hasConfig ? '✓' : '—'}`, '', hasConfig ? 'check' : 'dash'),
      ];
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

      if (hasConfig) {
        item.contextValue = 'configuredProject';
      }

      return item;
    });
  }
}

class ProjectItem extends vscode.TreeItem {
  children?: ProjectItem[];

  constructor(label: string, detail: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    if (detail) {
      this.resourceUri = vscode.Uri.file(detail);
    }
  }
}

// ─── Components Tree ─────────────────────────────────────────────

export class ComponentsProvider implements vscode.TreeDataProvider<ComponentTreeItem> {
  private _onDidChange = new vscode.EventEmitter<ComponentTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: ComponentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ComponentTreeItem): ComponentTreeItem[] {
    if (element) {
      return element.children || [];
    }

    const projects = discoverWorkspaceProjects();
    if (projects.length === 0) {
      return [new ComponentTreeItem('No AEM projects found', 'warning')];
    }

    // If only one project, show its components directly
    if (projects.length === 1) {
      return this.buildComponentTree(projects[0]);
    }

    // Multiple projects — show each as a top-level node
    return projects.map((p) => {
      const item = new ComponentTreeItem(p.artifactId, 'project');
      item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      item.children = this.buildComponentTree(p);
      return item;
    });
  }

  private buildComponentTree(project: ProjectInfo): ComponentTreeItem[] {
    let result: ScanResult;
    let showQuality = false;
    try {
      const config = configExists(project.root) ? loadConfig(project.root) : getDefaults(project.artifactId);
      result = scanComponents(project.root, config);
      // Quality scores only show here when the project opted into the "Quality metrics"
      // feature — the catalog itself is a showcase by default, not a scorecard, and the
      // sidebar should read the same way.
      showQuality = Boolean(config.features.qualityScore);
    } catch {
      return [new ComponentTreeItem('Scan failed', 'warning')];
    }

    if (result.total === 0) {
      return [new ComponentTreeItem('No components found', 'info')];
    }

    // Summary node
    const summary = new ComponentTreeItem(
      showQuality
        ? `${result.total} components · quality ${result.averageQualityScore}/100`
        : `${result.total} components · ${Object.keys(result.groups).length} categories`,
      'info',
    );

    // Group nodes
    const groupNodes = Object.entries(result.groups)
      .sort((a, b) => b[1] - a[1])
      .map(([group, count]) => {
        const shortGroup = group.replace(/.*-\s*/, '');
        const groupItem = new ComponentTreeItem(`${shortGroup} (${count})`, 'symbol-enum');
        groupItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        groupItem.children = result.components
          .filter((c) => c.group === group)
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((c) => this.buildComponentItem(c, showQuality));
        return groupItem;
      });

    return [summary, ...groupNodes];
  }

  private buildComponentItem(comp: ScannedComponent, showQuality: boolean): ComponentTreeItem {
    const icon = comp.hasDialog ? 'symbol-class' : 'symbol-interface';
    const item = new ComponentTreeItem(comp.title, icon);
    item.description = showQuality
      ? `${comp.quality.score}/100 · ${comp.status || 'unset'}`
      : comp.status || 'unset';
    item.tooltip = [
      comp.title,
      `Resource Type: ${comp.resourceType}`,
      comp.superType ? `Super Type: ${comp.superType}` : '',
      `Container: ${comp.isContainer ? 'Yes' : 'No'}`,
      `Dialog: ${comp.hasDialog ? '✓' : '—'}`,
      `README: ${comp.hasReadme ? '✓' : '—'}`,
      `Thumbnail: ${comp.hasThumbnail ? '✓' : '—'}`,
      comp.layoutFiles.length > 0 ? `Layouts: ${comp.layoutFiles.join(', ')}` : '',
      `Owner: ${comp.owner || 'unowned'}`,
      `Status: ${comp.status || 'unset'}`,
      `Version: ${comp.version || 'unset'}`,
      `Quality: ${comp.quality.score}/100 (${comp.quality.grade})`,
    ]
      .filter(Boolean)
      .join('\n');

    // Click to open .content.xml
    item.command = {
      command: 'vscode.open',
      title: 'Open Component',
      arguments: [vscode.Uri.file(comp.sourcePath)],
    };

    // Children: metadata
    item.collapsibleState = vscode.TreeItemCollapsibleState.None;

    return item;
  }
}

class ComponentTreeItem extends vscode.TreeItem {
  children?: ComponentTreeItem[];

  constructor(label: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}
