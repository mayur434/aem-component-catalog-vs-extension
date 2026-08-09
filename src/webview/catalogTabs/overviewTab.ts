import * as vscode from 'vscode';
import { projectId, escapeHtml } from '../../utils/webviewHelpers';
import { configExists, loadConfig } from '../../config/loader';
import { runDoctor, type DoctorFinding } from '../../core/doctor';
import { getDefaults } from '../../config/defaults';
import { scanComponents, type ScanResult } from '../../scanner/componentScanner';
import type { ProjectInfo } from '../../scanner/projectDetector';
import { discoverWorkspaceProjects } from '../../commands/projectSelection';
import type { TabRenderResult } from './types';

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

export function buildOverviewTab(): TabRenderResult {
  const projects = dashboardData();
  return {
    bodyHtml: renderOverviewBody(projects),
    styles: overviewStyles(),
    script: overviewScript(),
  };
}

export async function handleOverviewMessage(
  panel: vscode.WebviewPanel,
  msg: Record<string, unknown>,
  onRefresh?: () => void,
): Promise<void> {
  void onRefresh;
  if (!isOverviewMessage(msg)) return;
  const project = discoverWorkspaceProjects().find(
    (candidate) => projectId(candidate.root) === msg.projectId,
  );
  if (!project) {
    vscode.window.showErrorMessage(
      'The selected AEMaaCS project is no longer available in this workspace.',
    );
    return;
  }
  if (msg.action === 'openConfig') {
    panel.webview.postMessage({ tab: '_shell', type: 'activateTab', activeTab: 'configure' });
    panel.webview.postMessage({ tab: 'configure', type: 'selectProject', projectId: msg.projectId });
  } else {
    await vscode.commands.executeCommand(`aemComponentLibrary.${msg.action}`, project.root);
  }
}

function dashboardData(): DashboardProject[] {
  return discoverWorkspaceProjects().map((info) => {
    const configured = configExists(info.root);
    const config = (() => { try { return configured ? loadConfig(info.root) : getDefaults(info.artifactId); } catch { return getDefaults(info.artifactId); } })();
    let scan: ScanResult;
    let findings: DoctorFinding[] = [];
    let errors = 0;
    let warnings = 0;
    try {
      scan = scanComponents(info.root, config);
      const report = runDoctor(info.root, { config: configured ? config : undefined });
      findings = report.findings.slice(0, 8);
      errors = report.summary.errors;
      warnings = report.summary.warnings;
    } catch (error) {
      scan = scanComponents(info.root, getDefaults(info.artifactId));
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

function renderOverviewBody(projects: DashboardProject[]): string {
  return `<div id="ov-content">${renderOverviewInner(projects)}</div>`;
}

/** Content only, no id="ov-content" wrapper — used for the in-place refresh so the swap target's own id is never duplicated inside itself. */
function renderOverviewInner(projects: DashboardProject[]): string {
  const totals = projects.reduce(
    (result, project) => ({
      components: result.components + project.scan.total,
      categories: result.categories + Object.keys(project.scan.groups).length,
      configured: result.configured + (project.configured ? 1 : 0),
    }),
    { components: 0, categories: 0, configured: 0 },
  );
  return `<section class="metrics" aria-label="Workspace summary">
      ${metric('Projects', projects.length)}
      ${metric('Configured', `${totals.configured}/${projects.length}`)}
      ${metric('Components', totals.components)}
      ${metric('Categories', totals.categories)}
    </section>
    ${projects.length ? projects.map(projectCard).join('\n') : emptyState()}`;
}

/** Fresh inner HTML for the overview refresh push (see catalogPanel.ts's pushOverviewRefresh). */
export function refreshOverviewHtml(): string {
  return renderOverviewInner(dashboardData());
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
            <h3>Component detail <span>${project.scan.total > 100 ? `showing 100 of ${project.scan.total}` : `${project.scan.total} total`}</span></h3>
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
  return `<section class="empty" id="ov-noproject" role="alert"><h2>No AEM project found</h2><p>Open a workspace containing an AEMaaCS or AMS project with core, ui.apps, and ui.config modules.</p></section>`;
}

function scoreClass(score: number): string {
  return score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad';
}

function isOverviewMessage(value: unknown): value is { action: DashboardAction; projectId: string } {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.action === 'string' &&
    allowedActions.has(message.action as DashboardAction) &&
    typeof message.projectId === 'string' &&
    /^[a-f0-9]{16}$/.test(message.projectId)
  );
}

function overviewStyles(): string {
  return `
#tab-overview .hero {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--border);
}
#tab-overview h1,
#tab-overview h2,
#tab-overview h3,
#tab-overview p {
  margin-top: 0;
}
#tab-overview h1 {
  margin-bottom: 6px;
  font-size: 26px;
}
#tab-overview h2 {
  margin-bottom: 5px;
}
#tab-overview h3 {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}
#tab-overview h3 span,
#tab-overview .path,
#tab-overview .subtitle {
  color: var(--muted);
  font-size: 12px;
  font-weight: normal;
}
#tab-overview .eyebrow {
  margin-bottom: 6px;
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
}
#tab-overview .trust,
#tab-overview .status {
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
#tab-overview .ok,
#tab-overview .good {
  color: var(--good);
}
#tab-overview .blocked,
#tab-overview .bad {
  color: var(--bad);
}
#tab-overview .warn {
  color: var(--warn);
}
#tab-overview .metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(100px, 1fr));
  gap: 10px;
  margin: 22px 0;
}
#tab-overview .metric {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
#tab-overview .metric strong {
  font-size: 22px;
}
#tab-overview .metric span {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
}
#tab-overview .project {
  margin-bottom: 18px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
}
#tab-overview .project-heading {
  display: flex;
  justify-content: space-between;
  gap: 20px;
}
#tab-overview .path {
  word-break: break-all;
}
#tab-overview .stats {
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
}
#tab-overview .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 15px 0 20px;
}
#tab-overview .advanced {
  margin-top: 4px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
#tab-overview .advanced summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  list-style: none;
}
#tab-overview .advanced summary::-webkit-details-marker {
  display: none;
}
#tab-overview .advanced summary::before {
  content: '\\25B8';
  display: inline-block;
  margin-right: 6px;
  transition: transform 0.1s;
}
#tab-overview .advanced[open] summary::before {
  transform: rotate(90deg);
}
#tab-overview .advanced summary .muted {
  font-weight: normal;
  color: var(--muted);
}
#tab-overview .advanced-body {
  padding-top: 14px;
}
#tab-overview button {
  padding: 7px 11px;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 4px;
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  font: inherit;
  cursor: pointer;
}
#tab-overview button:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}
#tab-overview button:focus-visible {
  outline: 2px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}
#tab-overview button.primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
#tab-overview button.primary:hover {
  background: var(--vscode-button-hoverBackground);
}
#tab-overview button:disabled {
  opacity: 0.55;
  cursor: progress;
}
#tab-overview .project-grid {
  display: grid;
  grid-template-columns: minmax(250px, 0.8fr) minmax(0, 1.4fr);
  gap: 18px;
}
#tab-overview .findings {
  margin: 0;
  padding: 0;
  list-style: none;
}
#tab-overview .finding {
  display: grid;
  grid-template-columns: 55px 1fr;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}
#tab-overview .finding > span {
  font-size: 9px;
  font-weight: 800;
}
#tab-overview .finding strong {
  display: block;
  font-size: 12px;
}
#tab-overview .finding small {
  color: var(--muted);
}
#tab-overview .finding.error > span {
  color: var(--bad);
}
#tab-overview .finding.warning > span {
  color: var(--warn);
}
#tab-overview .finding.info > span {
  color: var(--good);
}
#tab-overview .table-wrap {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
#tab-overview table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
#tab-overview th,
#tab-overview td {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
#tab-overview th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel);
  color: var(--muted);
}
#tab-overview code {
  font-family: var(--vscode-editor-font-family);
}
#tab-overview .score {
  font-weight: 700;
}
#tab-overview .empty {
  padding: 36px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  text-align: center;
  color: var(--muted);
}

@media (max-width: 900px) {
  #tab-overview .metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  #tab-overview .project-grid {
    grid-template-columns: 1fr;
  }
  #tab-overview .hero,
  #tab-overview .project-heading {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  #tab-overview .advanced summary::before {
    transition: none;
  }
}
`;
}

function overviewScript(): string {
  return `
document.addEventListener('click', function (event) {
  const target = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  if (!target) return;
  const container = target.closest('[data-project]');
  const action = target.getAttribute('data-action');
  const projectId = container && container.getAttribute('data-project');
  if (!action || !projectId) return;
  target.setAttribute('disabled', 'true');
  vscode.postMessage({ tab: 'overview', action: action, projectId: projectId });
  setTimeout(function () {
    target.removeAttribute('disabled');
  }, 3000);
});
window.addEventListener('message', function (e) {
  if (e.data && e.data.tab === 'overview' && e.data.type === 'refreshHtml') {
    document.getElementById('ov-content').innerHTML = e.data.bodyHtml;
  }
});
`;
}
