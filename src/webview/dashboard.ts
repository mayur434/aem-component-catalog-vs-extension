import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { configExists, loadConfig } from '../config/loader';
import { runDoctor, type DoctorFinding } from '../core/doctor';
import { getDefaults } from '../config/defaults';
import { scanComponents, type ScanResult } from '../scanner/componentScanner';
import type { ProjectInfo } from '../scanner/projectDetector';
import { discoverWorkspaceProjects } from '../commands/projectSelection';

let currentPanel: vscode.WebviewPanel | undefined;

interface DashboardProject {
  id: string;
  info: ProjectInfo;
  configured: boolean;
  scan: ScanResult;
  findings: DoctorFinding[];
  errors: number;
  warnings: number;
}

type DashboardAction =
  | 'deployLocal'
  | 'preview'
  | 'doctor'
  | 'rollback'
  | 'exportSupportBundle'
  | 'openConfig';

const allowedActions = new Set<DashboardAction>([
  'deployLocal',
  'preview',
  'doctor',
  'rollback',
  'exportSupportBundle',
  'openConfig',
]);

export function openDashboard(context: vscode.ExtensionContext, onRefresh?: () => void): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    return;
  }
  const resources = vscode.Uri.joinPath(context.extensionUri, 'resources');
  const panel = vscode.window.createWebviewPanel(
    'aemCatalogDashboard',
    'AEM Component Catalog',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [resources],
    },
  );
  currentPanel = panel;
  panel.iconPath = vscode.Uri.joinPath(resources, 'icon.svg');

  const refresh = (): void => {
    panel.webview.html = renderDashboard(panel.webview, context.extensionUri, dashboardData());
  };
  refresh();

  panel.webview.onDidReceiveMessage(
    async (message: unknown) => {
      if (!isDashboardMessage(message)) return;
      const project = discoverWorkspaceProjects().find(
        (candidate) => projectId(candidate.root) === message.projectId,
      );
      if (!project) {
        vscode.window.showErrorMessage(
          'The selected AEMaaCS project is no longer available in this workspace.',
        );
        return;
      }
      if (message.action === 'openConfig') {
        await vscode.commands.executeCommand('aemComponentLibrary.configure');
      } else {
        await vscode.commands.executeCommand(`aemComponentLibrary.${message.action}`, project.root);
      }
      refresh();
      onRefresh?.();
    },
    undefined,
    context.subscriptions,
  );
  panel.onDidDispose(
    () => {
      currentPanel = undefined;
    },
    undefined,
    context.subscriptions,
  );
}

function dashboardData(): DashboardProject[] {
  return discoverWorkspaceProjects().map((info) => {
    const configured = configExists(info.root);
    let scan = scanComponents(info.root, getDefaults(info.artifactId));
    let findings: DoctorFinding[] = [];
    let errors = 0;
    let warnings = 0;
    try {
      const config = configured ? loadConfig(info.root) : getDefaults(info.artifactId);
      scan = scanComponents(info.root, config);
      const report = runDoctor(info.root, { config: configured ? config : undefined });
      findings = report.findings.slice(0, 8);
      errors = report.summary.errors;
      warnings = report.summary.warnings;
    } catch (error) {
      findings = [
        {
          ruleId: 'catalog.config',
          severity: 'error',
          title: 'Dashboard data could not be loaded',
          message: error instanceof Error ? error.message : String(error),
        },
      ];
      errors = 1;
    }
    return { id: projectId(info.root), info, configured, scan, findings, errors, warnings };
  });
}

function renderDashboard(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  projects: DashboardProject[],
): string {
  const nonce = crypto.randomBytes(18).toString('base64');
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'dashboard.css'));
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'dashboard.js'));
  const totals = projects.reduce(
    (result, project) => ({
      components: result.components + project.scan.total,
      categories: result.categories + Object.keys(project.scan.groups).length,
      configured: result.configured + (project.configured ? 1 : 0),
    }),
    { components: 0, categories: 0, configured: 0 },
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
  <title>AEM Component Catalog</title>
</head>
<body>
  <header class="hero">
    <div>
      <p class="eyebrow">AEM AS A CLOUD SERVICE</p>
      <h1>Component Catalog</h1>
      <p class="subtitle">Configure, generate, and deploy your team's component showcase.</p>
    </div>
    <span class="trust ${vscode.workspace.isTrusted ? 'ok' : 'blocked'}">${vscode.workspace.isTrusted ? 'Workspace trusted' : 'Restricted mode'}</span>
  </header>
  <main>
    <section class="metrics" aria-label="Workspace summary">
      ${metric('Projects', projects.length)}
      ${metric('Configured', `${totals.configured}/${projects.length}`)}
      ${metric('Components', totals.components)}
      ${metric('Categories', totals.categories)}
    </section>
    ${projects.length ? projects.map(projectCard).join('\n') : emptyState()}
  </main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function projectCard(project: DashboardProject): string {
  const status = project.configured ? 'Configured' : 'Not configured yet';
  const statusClass = project.configured ? 'good' : 'warn';
  const componentRows = project.scan.components
    .slice(0, 100)
    .map(
      (component) => `<tr>
        <td><code>${escapeHtml(component.resourceType)}</code></td>
        <td>${escapeHtml(component.owner || 'unowned')}</td>
        <td>${escapeHtml(component.status || 'unset')}</td>
        <td><span class="score ${scoreClass(component.quality.score)}">${component.quality.score}</span></td>
      </tr>`,
    )
    .join('');
  const findingRows = project.findings.length
    ? project.findings
        .map(
          (finding) => `<li class="finding ${finding.severity}">
            <span>${escapeHtml(finding.severity.toUpperCase())}</span>
            <div><strong>${escapeHtml(finding.title)}</strong><small>${escapeHtml(finding.ruleId)}</small></div>
          </li>`,
        )
        .join('')
    : '<li class="finding info"><span>PASS</span><div><strong>No Cloud Doctor findings</strong></div></li>';
  const findingSummary = project.errors || project.warnings
    ? `${project.errors} error${project.errors === 1 ? '' : 's'} · ${project.warnings} warning${project.warnings === 1 ? '' : 's'}`
    : 'All clear';
  return `<article class="project">
    <div class="project-heading">
      <div>
        <p class="eyebrow">${escapeHtml(project.info.groupId)}</p>
        <h2>${escapeHtml(project.info.artifactId)}</h2>
        <p class="path">${escapeHtml(project.info.root)}</p>
      </div>
      <span class="status ${statusClass}">${status}</span>
    </div>
    <div class="stats">${project.scan.total} component${project.scan.total === 1 ? '' : 's'} · ${Object.keys(project.scan.groups).length} categor${Object.keys(project.scan.groups).length === 1 ? 'y' : 'ies'}</div>
    <div class="actions" data-project="${project.id}">
      <button data-action="openConfig" class="primary">Configure &amp; Generate</button>
      <button data-action="deployLocal">Deploy to Local AEM</button>
      <button data-action="preview">Preview plan</button>
    </div>
    <details class="advanced">
      <summary>Advanced <span class="muted">— rollback, Cloud Doctor, support bundle</span></summary>
      <div class="advanced-body">
        <div class="actions" data-project="${project.id}">
          <button data-action="rollback">Roll back last generation</button>
          <button data-action="doctor">Run Cloud Doctor</button>
          <button data-action="exportSupportBundle">Export support bundle</button>
        </div>
        <div class="project-grid">
          <section>
            <h3>Cloud Doctor <span>${findingSummary}</span></h3>
            <ul class="findings">${findingRows}</ul>
          </section>
          <section>
            <h3>Component detail <span>${project.scan.total} total</span></h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Resource type</th><th>Owner</th><th>Status</th><th>Quality</th></tr></thead>
                <tbody>${componentRows || '<tr><td colspan="4">No components discovered.</td></tr>'}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </details>
  </article>`;
}

function metric(label: string, value: string | number): string {
  return `<div class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function emptyState(): string {
  return `<section class="empty"><h2>No AEMaaCS project found</h2><p>Open a current AEM Project Archetype workspace containing core, ui.apps, ui.config, all, and Cloud SDK markers.</p></section>`;
}

function projectId(root: string): string {
  return crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
}

function scoreClass(score: number): string {
  return score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isDashboardMessage(value: unknown): value is { action: DashboardAction; projectId: string } {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.action === 'string' &&
    allowedActions.has(message.action as DashboardAction) &&
    typeof message.projectId === 'string' &&
    /^[a-f0-9]{16}$/.test(message.projectId)
  );
}
