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
  passed: boolean;
}

type DashboardAction =
  | 'init'
  | 'generate'
  | 'update'
  | 'preview'
  | 'scan'
  | 'doctor'
  | 'rollback'
  | 'exportSupportBundle'
  | 'openConfig';

const allowedActions = new Set<DashboardAction>([
  'init',
  'generate',
  'update',
  'preview',
  'scan',
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
    'aemEnterpriseCatalogDashboard',
    'AEMaaCS Component Catalog',
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
        const file = vscode.Uri.joinPath(vscode.Uri.file(project.root), '.component-library.json');
        if (!configExists(project.root)) {
          await vscode.commands.executeCommand('aemComponentLibrary.init', project.root);
        } else {
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
        }
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
    let passed = false;
    try {
      const config = configured ? loadConfig(info.root) : getDefaults(info.artifactId);
      scan = scanComponents(info.root, config);
      const report = runDoctor(info.root, { config: configured ? config : undefined });
      findings = report.findings.slice(0, 8);
      errors = report.summary.errors;
      warnings = report.summary.warnings;
      passed = report.summary.passed;
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
    return { id: projectId(info.root), info, configured, scan, findings, errors, warnings, passed };
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
      errors: result.errors + project.errors,
      warnings: result.warnings + project.warnings,
      quality: result.quality + project.scan.averageQualityScore,
    }),
    { components: 0, errors: 0, warnings: 0, quality: 0 },
  );
  const averageQuality = projects.length ? Math.round(totals.quality / projects.length) : 0;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
  <title>AEMaaCS Component Catalog</title>
</head>
<body>
  <header class="hero">
    <div>
      <p class="eyebrow">AEM AS A CLOUD SERVICE</p>
      <h1>Enterprise Component Catalog</h1>
      <p class="subtitle">Governance, generation safety, and Cloud readiness from one workspace.</p>
    </div>
    <span class="trust ${vscode.workspace.isTrusted ? 'ok' : 'blocked'}">${vscode.workspace.isTrusted ? 'Workspace trusted' : 'Restricted mode'}</span>
  </header>
  <main>
    <section class="metrics" aria-label="Portfolio summary">
      ${metric('Projects', projects.length)}
      ${metric('Components', totals.components)}
      ${metric('Avg. quality', `${averageQuality}/100`)}
      ${metric('Errors', totals.errors, totals.errors ? 'bad' : 'good')}
      ${metric('Warnings', totals.warnings, totals.warnings ? 'warn' : 'good')}
    </section>
    ${projects.length ? projects.map(projectCard).join('\n') : emptyState()}
  </main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function projectCard(project: DashboardProject): string {
  const status = !project.configured
    ? 'Not configured'
    : project.passed
      ? 'Cloud Doctor passed'
      : 'Action required';
  const statusClass = !project.configured ? 'warn' : project.passed ? 'good' : 'bad';
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
    : '<li class="finding info"><span>PASS</span><div><strong>No policy findings</strong></div></li>';
  return `<article class="project">
    <div class="project-heading">
      <div>
        <p class="eyebrow">${escapeHtml(project.info.groupId)}</p>
        <h2>${escapeHtml(project.info.artifactId)}</h2>
        <p class="path">${escapeHtml(project.info.root)}</p>
      </div>
      <span class="status ${statusClass}">${status}</span>
    </div>
    <div class="actions" data-project="${project.id}">
      <button data-action="${project.configured ? 'openConfig' : 'init'}">${project.configured ? 'Open configuration' : 'Initialize'}</button>
      <button data-action="doctor">Run Cloud Doctor</button>
      <button data-action="preview">Preview plan</button>
      <button data-action="generate" class="primary">Generate</button>
      <button data-action="rollback">Rollback</button>
      <button data-action="exportSupportBundle">Support bundle</button>
    </div>
    <div class="project-grid">
      <section>
        <h3>Governance findings <span>${project.errors} errors · ${project.warnings} warnings</span></h3>
        <ul class="findings">${findingRows}</ul>
      </section>
      <section>
        <h3>Component portfolio <span>${project.scan.total} total · ${project.scan.averageQualityScore}/100</span></h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Resource type</th><th>Owner</th><th>Status</th><th>Quality</th></tr></thead>
            <tbody>${componentRows || '<tr><td colspan="4">No components discovered.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    </div>
  </article>`;
}

function metric(label: string, value: string | number, tone = ''): string {
  return `<div class="metric ${tone}"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
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
