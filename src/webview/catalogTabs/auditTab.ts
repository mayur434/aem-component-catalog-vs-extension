/**
 * Audit tab — DEPT branded enterprise component tech audit.
 *
 * Provides project selection, content-package configuration, duplicate
 * threshold, live progress, inline results dashboard, and one-click Excel
 * export, rendered as one tab inside the unified Catalog panel.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type { TabRenderResult } from './types';
import { discoverWorkspaceProjects } from '../../commands/projectSelection';
import { runAudit } from '../../audit/auditEngine';
import { generateExcelReport } from '../../audit/excelReporter';
import type { AuditResult } from '../../audit/types';
import { projectId, dateStamp } from '../../utils/webviewHelpers';

let lastAuditResult: AuditResult | undefined;

interface AuditProject {
  id: string;
  artifactId: string;
  groupId: string;
  version: string;
  root: string;
  platform: string;
  platformLabel: string;
  modules: string[];
  javaVersion: string;
}

export function buildAuditTab(preselectRoot?: string): TabRenderResult {
  const projects = buildProjectState();
  const preselectId = preselectRoot ? projectId(preselectRoot) : undefined;
  const stateJson = JSON.stringify({ projects, preselectId }).replace(/</g, '\\u003c');
  const script = `const STATE=${stateJson};
${auditClientScript()}`;
  return { bodyHtml: auditBodyHtml(), styles: auditStyles(), script };
}

export async function handleAuditMessage(
  panel: vscode.WebviewPanel,
  msg: Record<string, unknown>,
): Promise<void> {
  if (msg.type === 'runAudit') await handleRunAudit(panel, msg);
  else if (msg.type === 'browsePackages') await handleBrowsePackages(panel);
  else if (msg.type === 'exportExcel') await handleExportExcel(panel);
  else if (msg.type === 'openFile') handleOpenFile(msg);
}

async function handleBrowsePackages(panel: vscode.WebviewPanel): Promise<void> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: true,
    openLabel: 'Select Content Package Folder',
    title: 'Select folder(s) containing AEM content package ZIPs',
  });
  if (folders) {
    panel.webview.postMessage({
      tab: 'audit',
      type: 'packagesSelected',
      paths: folders.map((f) => f.fsPath),
    });
  }
}

async function handleRunAudit(panel: vscode.WebviewPanel, msg: Record<string, unknown>): Promise<void> {
  const selectedIds = msg.projectIds as string[];
  const contentPaths = (msg.contentPaths as string[]) ?? [];
  const threshold = (msg.duplicateThreshold as number) ?? 50;

  const allProjects = discoverWorkspaceProjects();
  const selected = allProjects.filter((p) =>
    selectedIds.includes(projectId(p.root)),
  );

  if (selected.length === 0) {
    panel.webview.postMessage({ tab: 'audit', type: 'auditError', error: 'No projects selected.' });
    return;
  }

  panel.webview.postMessage({ tab: 'audit', type: 'auditProgress', step: 'scanning', detail: `Scanning ${selected.length} project(s)...` });

  try {
    const result = runAudit(selected, {
      contentPackagePaths: contentPaths,
      duplicateThreshold: threshold,
    });
    lastAuditResult = result;

    panel.webview.postMessage({ tab: 'audit', type: 'auditProgress', step: 'generating', detail: 'Preparing results...' });

    const serializable = {
      projects: result.projects,
      summary: result.summary,
      duplicates: result.duplicates,
      crossSiteReuse: result.crossSiteReuse,
      recommendations: result.recommendations,
      usageCoverage: result.usageCoverage,
      contentPackageMeta: result.contentPackageMeta,
      generatedAt: result.generatedAt,
      componentCount: result.components.length,
      topUnused: result.components
        .filter((c) => c.usageCount === 0)
        .slice(0, 20)
        .map((c) => ({ resourceType: c.resourceType, site: c.site, classification: c.classification })),
      topUsed: [...result.components]
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 10)
        .map((c) => ({ resourceType: c.resourceType, site: c.site, usageCount: c.usageCount })),
    };

    panel.webview.postMessage({ tab: 'audit', type: 'auditComplete', result: serializable });
  } catch (err) {
    panel.webview.postMessage({
      tab: 'audit',
      type: 'auditError',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleExportExcel(panel: vscode.WebviewPanel): Promise<void> {
  if (!lastAuditResult) {
    vscode.window.showErrorMessage('No audit results available. Run the audit first.');
    return;
  }
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const outputUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspace, `dept-aem-audit-${dateStamp()}.xlsx`)),
    filters: { 'Excel Workbook': ['xlsx'] },
    title: 'Save DEPT Audit Report',
  });
  if (!outputUri) return;

  try {
    const reportPath = await generateExcelReport(lastAuditResult, outputUri.fsPath);
    panel.webview.postMessage({ tab: 'audit', type: 'exportComplete', path: reportPath });
    const action = await vscode.window.showInformationMessage(
      `DEPT audit report saved: ${path.basename(reportPath)}`,
      'Open Report',
    );
    if (action === 'Open Report') {
      vscode.env.openExternal(vscode.Uri.file(reportPath));
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to export: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function handleOpenFile(msg: Record<string, unknown>): void {
  const filePath = msg.path as string;
  if (filePath) {
    vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: true });
  }
}

function buildProjectState(): AuditProject[] {
  return discoverWorkspaceProjects().map((p) => ({
    id: projectId(p.root),
    artifactId: p.artifactId,
    groupId: p.groupId,
    version: p.version,
    root: p.root,
    platform: p.platform,
    platformLabel: p.platform === 'aemaacs' ? 'AEMaaCS' : 'AEM AMS',
    modules: p.modules,
    javaVersion: p.javaVersion,
  }));
}

function auditBodyHtml(): string {
  return `<section class="card" id="aud-noproject" hidden role="alert">
  <div class="empty-state">
    <div class="empty-icon-wrap"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>
    <h2>No AEM Projects Found</h2>
    <p>Open an AEM Project Archetype workspace (AEMaaCS or AMS) to run the tech audit.</p>
  </div>
</section>

<div id="aud-configSection">
  <section class="card">
    <div class="card-header"><h2>Projects</h2><span class="card-count" id="aud-projectCount"></span></div>
    <p class="hint">Select projects to include in the audit. Both AEMaaCS and AEM AMS are supported.</p>
    <div class="select-actions" id="aud-selectActions">
      <button type="button" class="link-btn" id="aud-selectAll">Select all</button>
      <span class="select-sep">|</span>
      <button type="button" class="link-btn" id="aud-deselectAll">Deselect all</button>
    </div>
    <div id="aud-projectList" class="project-list" role="group" aria-label="Project selection"></div>
  </section>

  <section class="card">
    <div class="card-header"><h2>Content Packages</h2><span class="card-badge optional">Optional</span></div>
    <p class="hint">Provide CRX content package <strong>.zip</strong> files to analyze real production usage data. Without this, usage counts will be zero.</p>
    <div class="toggle-row">
      <button type="button" class="toggle-switch" id="aud-cpToggle" role="switch" aria-checked="false" aria-label="Analyze content packages">
        <span class="track" aria-hidden="true"></span>
        <span>Analyze content packages</span>
      </button>
    </div>
    <div id="aud-cpConfig" class="cp-config" hidden>
      <div class="cp-guide">
        <p class="guide-title">How to get content packages</p>
        <ol class="guide-steps">
          <li>Open <strong>CRX Package Manager</strong> on your AEM instance (<code>/crx/packmgr/index.jsp</code>)</li>
          <li>Create a package with filter <code>/content/&lt;your-site&gt;</code> (or download an existing content package)</li>
          <li>Build and download the <code>.zip</code> file to your local machine</li>
          <li>Browse to the <strong>folder</strong> containing the downloaded <code>.zip</code> file(s) below</li>
        </ol>
        <p class="guide-note">Accepts: a folder containing <code>.zip</code> files — all ZIPs in the folder will be scanned. The parser reads <code>jcr_root/content/</code> entries and extracts <code>sling:resourceType</code> references to calculate per-component usage counts.</p>
      </div>
      <div class="cp-paths" id="aud-cpPaths">
        <p class="muted">No folders selected.</p>
      </div>
      <button type="button" class="ghost-btn" id="aud-browsePkgs">Browse for folder</button>
    </div>
  </section>

  <section class="card">
    <div class="card-header"><h2>Configuration</h2></div>
    <div class="config-grid">
      <div class="config-item">
        <label class="field-label" for="aud-threshold">Duplicate detection threshold</label>
        <div class="slider-row">
          <input type="range" id="aud-threshold" min="30" max="100" value="50" step="5"/>
          <span id="aud-thresholdVal" class="slider-val">50%</span>
        </div>
        <div class="derivation-box">
          <p class="derivation-title">How this works</p>
          <p class="derivation-text">Components with the <strong>same leaf name</strong> across different sites are compared pairwise. Each component's files (<code>.content.xml</code>, <code>.html</code>, <code>.js</code>, <code>.css</code>, <code>.less</code>, <code>.scss</code>, <code>.json</code>) are hashed using <strong>SHA-256</strong> (content-normalized, whitespace-trimmed). The <strong>similarity score</strong> is calculated as:</p>
          <p class="derivation-formula">Similarity % = (matching file hashes / total unique files across both components) &times; 100</p>
          <p class="derivation-text">Pairs scoring <strong>at or above the threshold</strong> are flagged as duplicates. A score of <strong>100%</strong> means identical files &rarr; recommended to remove duplicate. <strong>&ge;80%</strong> means near-identical &rarr; recommended to merge. <strong>Below 80%</strong> &rarr; keep separate (reviewed).</p>
        </div>
      </div>
    </div>
  </section>

  <div class="run-section">
    <div id="aud-progressArea" class="progress-area" hidden>
      <div class="progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" id="aud-progressFill"></div></div>
      <p id="aud-progressText" class="progress-text" aria-live="polite">Initializing...</p>
    </div>
    <div id="aud-auditError" class="audit-error" hidden role="alert"></div>
    <button type="button" class="primary run-btn" id="aud-runBtn">Run Component Audit</button>
  </div>
</div>

<div id="aud-resultsSection" hidden tabindex="-1">
  <div class="results-banner">
    <div class="results-banner-left">
      <div>
        <p class="eyebrow">AUDIT RESULTS</p>
        <p class="results-sub" id="aud-resultsSub"></p>
      </div>
    </div>
    <div class="results-actions">
      <button type="button" class="btn-secondary" id="aud-rerunBtn">Run Again</button>
      <button type="button" class="btn-primary" id="aud-exportBtn">Export Excel Report</button>
    </div>
  </div>
  <div id="aud-exportStatus" class="export-status" hidden></div>

  <section class="metrics-grid" id="aud-metricsGrid"></section>

  <div class="results-grid">
    <section class="card" id="aud-classificationCard">
      <h3>Classification Breakdown</h3>
      <div id="aud-classChart" class="class-chart"></div>
      <div id="aud-classLegend" class="class-legend"></div>
    </section>

    <section class="card" id="aud-techMetricsCard">
      <h3>Technical Metrics</h3>
      <div id="aud-techMetrics" class="tech-list"></div>
    </section>
  </div>

  <div class="results-grid">
    <section class="card" id="aud-coreModelCard">
      <h3>Core Component Sling Models</h3>
      <div id="aud-coreModelContent"></div>
    </section>

    <section class="card" id="aud-siteBreakdownCard">
      <h3>Components by Site</h3>
      <div id="aud-siteBreakdownContent" class="breakdown-list"></div>
    </section>
  </div>

  <section class="card" id="aud-usageCoverageCard" hidden>
    <h3>Usage Coverage Summary</h3>
    <p class="hint" id="aud-coverageHint"></p>
    <div id="aud-usageCoverageContent"></div>
  </section>

  <section class="card" id="aud-duplicatesCard">
    <h3>Duplicate Analysis</h3>
    <div id="aud-duplicatesContent"></div>
  </section>

  <section class="card" id="aud-crossSiteCard">
    <h3>Cross-Site Reuse</h3>
    <div id="aud-crossSiteContent"></div>
  </section>

  <section class="card" id="aud-recsCard">
    <h3>Recommendations</h3>
    <div id="aud-recsContent"></div>
  </section>

  <div class="results-grid">
    <section class="card" id="aud-topUsedCard">
      <h3>Top Used Components</h3>
      <div id="aud-topUsedContent" class="table-wrap"></div>
    </section>

    <section class="card" id="aud-unusedCard">
      <h3>Unused Components</h3>
      <div id="aud-unusedContent" class="table-wrap"></div>
    </section>
  </div>

  <div class="results-footer">
    <span>Prepared by DEPT</span>
    <span id="aud-generatedAt"></span>
  </div>
</div>`;
}

function auditStyles(): string {
  return `
/* :root custom properties (--panel, --fg, --fg-muted, --accent, --card-bg, --border,
   --border-light, --input-bg, --btn-bg/--btn-fg/--btn-hover, --btn2-*) are defined once,
   shared across all tabs, in catalogPanel.ts's shellStyles(). */

/* Cards */
#tab-audit h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-muted);margin:0}
#tab-audit h3{font-size:14px;margin:0 0 14px;color:var(--fg);font-weight:600}
#tab-audit .card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:12px}
#tab-audit .card-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
#tab-audit .card-count{font-size:11px;font-weight:700;color:var(--fg);background:rgba(127,127,127,.12);padding:2px 8px;border-radius:8px}
#tab-audit .card-badge{font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600}
#tab-audit .card-badge.optional{color:var(--fg-muted);background:rgba(127,127,127,.1)}
#tab-audit .hint{color:var(--fg-muted);font-size:12px;margin:0 0 12px}
#tab-audit .muted{color:var(--fg-muted);font-size:12px;margin:6px 0 0}
#tab-audit .field-label{display:block;font-size:12px;color:var(--fg-muted);margin:0 0 6px;font-weight:600}

/* Select actions */
#tab-audit .select-actions{display:flex;align-items:center;gap:6px;margin-bottom:8px}
#tab-audit .link-btn{background:none;border:none;color:var(--accent);cursor:pointer;font:inherit;font-size:11px;padding:2px 4px;border-radius:3px}
#tab-audit .link-btn:hover{text-decoration:underline}
#tab-audit .link-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}
#tab-audit .select-sep{color:var(--fg-muted);font-size:11px}

/* Project list */
#tab-audit .project-list{display:flex;flex-direction:column;gap:6px}
#tab-audit .project-item{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .12s;background:none;width:100%;text-align:left;font:inherit;color:inherit}
#tab-audit .project-item:hover{border-color:var(--vscode-focusBorder);background:rgba(127,127,127,.04)}
#tab-audit .project-item:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
#tab-audit .project-item.selected{border-color:var(--fg);background:rgba(127,127,127,.08)}
#tab-audit .project-check{flex:none;width:18px;height:18px;border-radius:4px;border:2px solid rgba(127,127,127,.4);display:flex;align-items:center;justify-content:center;font-size:11px;color:transparent;transition:.12s}
#tab-audit .project-item.selected .project-check{border-color:var(--fg);background:var(--fg);color:var(--vscode-editor-background)}
#tab-audit .project-meta{flex:1;min-width:0}
#tab-audit .project-name{font-weight:600;font-size:13px}
#tab-audit .project-detail{color:var(--fg-muted);font-size:11px;margin-top:2px}
#tab-audit .platform-badge{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:.03em;margin-left:6px;background:rgba(127,127,127,.12);color:var(--fg)}

/* Toggle */
#tab-audit .toggle-row{margin-bottom:10px}
#tab-audit .toggle-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none;background:none;border:none;padding:4px 0;font:inherit;color:inherit}
#tab-audit .toggle-switch:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px;border-radius:4px}
#tab-audit .toggle-switch .track{flex:none;width:34px;height:20px;border-radius:20px;background:rgba(127,127,127,.35);position:relative;transition:.15s}
#tab-audit .toggle-switch .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
#tab-audit .toggle-switch.on .track{background:var(--btn-bg)}
#tab-audit .toggle-switch.on .track::after{transform:translateX(14px)}
#tab-audit .cp-config{margin-top:10px}
#tab-audit .cp-guide{margin-bottom:14px;padding:14px 16px;border-radius:8px;border:1px solid var(--border);background:rgba(127,127,127,.04)}
#tab-audit .guide-title{font-weight:700;font-size:12px;margin:0 0 8px}
#tab-audit .guide-steps{margin:0 0 10px;padding-left:20px;font-size:12px;line-height:1.8;color:var(--fg-muted)}
#tab-audit .guide-steps li{margin-bottom:2px}
#tab-audit .guide-steps strong{color:var(--fg)}
#tab-audit .guide-steps code{background:rgba(127,127,127,.12);padding:1px 5px;border-radius:3px;font-size:11px}
#tab-audit .guide-note{margin:0;font-size:11px;color:var(--fg-muted);line-height:1.6;border-top:1px solid var(--border-light);padding-top:10px}
#tab-audit .guide-note code{background:rgba(127,127,127,.12);padding:1px 5px;border-radius:3px;font-size:10px}
#tab-audit .cp-paths{margin-bottom:10px;padding:8px 12px;border-radius:6px;background:var(--input-bg);min-height:36px}
#tab-audit .cp-path{display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 0}
#tab-audit .cp-path .remove{cursor:pointer;color:var(--fg-muted);font-size:14px;border:none;background:none;padding:0 4px}
#tab-audit .cp-path .remove:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px;border-radius:2px}
#tab-audit .ghost-btn{padding:7px 14px;border:1px solid var(--vscode-button-border,var(--border));border-radius:4px;background:var(--btn2-bg);color:var(--btn2-fg);cursor:pointer;font:inherit;font-size:12px}
#tab-audit .ghost-btn:hover{background:var(--btn2-hover)}
#tab-audit .ghost-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}

/* Derivation box */
#tab-audit .derivation-box{margin-top:12px;padding:14px 16px;border-radius:8px;border:1px solid var(--border);background:rgba(127,127,127,.04)}
#tab-audit .derivation-title{font-weight:700;font-size:12px;margin:0 0 8px}
#tab-audit .derivation-text{font-size:12px;color:var(--fg-muted);margin:0 0 8px;line-height:1.7}
#tab-audit .derivation-text strong{color:var(--fg)}
#tab-audit .derivation-text code{background:rgba(127,127,127,.12);padding:1px 5px;border-radius:3px;font-size:11px}
#tab-audit .derivation-formula{font-size:12px;font-weight:600;color:var(--fg);margin:8px 0;padding:8px 12px;border-radius:6px;background:rgba(127,127,127,.08);font-family:var(--vscode-editor-font-family,monospace)}

/* Slider */
#tab-audit .slider-row{display:flex;align-items:center;gap:12px}
#tab-audit .slider-row input[type=range]{flex:1;-webkit-appearance:none;height:5px;border-radius:3px;background:rgba(127,127,127,.25);outline:none}
#tab-audit .slider-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:var(--fg);cursor:pointer;border:2px solid var(--vscode-editor-background);box-shadow:0 1px 3px rgba(0,0,0,.15)}
#tab-audit .slider-row input[type=range]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px;border-radius:3px}
#tab-audit .slider-val{font-weight:700;font-size:14px;min-width:36px;text-align:right}
#tab-audit .config-grid{display:flex;flex-direction:column;gap:16px}

/* Buttons — VS Code native styling */
#tab-audit .btn-primary{padding:8px 18px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--btn-bg);color:var(--btn-fg);font:inherit;font-weight:600;font-size:12px;cursor:pointer}
#tab-audit .btn-primary:hover{background:var(--btn-hover)}
#tab-audit .btn-primary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}
#tab-audit .btn-secondary{padding:8px 18px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--btn2-bg);color:var(--btn2-fg);font:inherit;font-size:12px;cursor:pointer}
#tab-audit .btn-secondary:hover{background:var(--btn2-hover)}
#tab-audit .btn-secondary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}

/* Run button & progress */
#tab-audit .run-section{margin:22px 0;display:flex;flex-direction:column;align-items:center;gap:14px}
#tab-audit .run-btn{padding:14px 40px;font-size:14px;border-radius:4px;background:var(--btn-bg);border:1px solid var(--vscode-button-border,transparent);color:var(--btn-fg);font-weight:700;cursor:pointer;transition:all .15s;letter-spacing:.02em}
#tab-audit .run-btn:hover{background:var(--btn-hover)}
#tab-audit .run-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
#tab-audit .run-btn:disabled{opacity:.4;cursor:default}
#tab-audit .progress-area{width:100%;max-width:500px}
#tab-audit .progress-bar{height:5px;border-radius:3px;background:rgba(127,127,127,.15);overflow:hidden}
#tab-audit .progress-fill{height:100%;border-radius:3px;background:var(--btn-bg);width:0%;transition:width .4s ease}
#tab-audit .progress-fill.indeterminate{width:100%;animation:aud-shimmer 1.5s infinite}
@keyframes aud-shimmer{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}
#tab-audit .progress-text{text-align:center;font-size:12px;color:var(--fg-muted);margin:8px 0 0}
#tab-audit .audit-error{padding:12px 16px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid var(--border);background:rgba(127,127,127,.06);color:var(--fg);text-align:center;max-width:500px;width:100%}

/* Results banner — themed card */
#tab-audit .results-banner{display:flex;align-items:center;justify-content:space-between;margin:20px 0 14px;padding:16px 18px;background:var(--panel);border:1px solid var(--border);border-radius:10px}
#tab-audit .results-banner-left{display:flex;align-items:center;gap:14px}
#tab-audit .results-banner .eyebrow{margin-bottom:0}
#tab-audit .results-sub{font-size:11px;color:var(--fg-muted);margin:4px 0 0}
#tab-audit .results-actions{display:flex;gap:8px;align-items:center}

/* Export status */
#tab-audit .export-status{padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px}
#tab-audit .export-status.ok{background:rgba(127,127,127,.08);color:var(--fg);border:1px solid var(--border)}
#tab-audit .export-status.err{background:rgba(127,127,127,.08);color:var(--fg);border:1px solid var(--border)}

/* Metrics grid — matches dashboard */
#tab-audit .metrics-grid{display:grid;grid-template-columns:repeat(5,minmax(100px,1fr));gap:10px;margin-bottom:14px}
#tab-audit .metric{display:flex;flex-direction:column;gap:3px;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
#tab-audit .metric strong{font-size:22px;font-weight:800}
#tab-audit .metric span{color:var(--fg-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em}
#tab-audit .metric.highlight strong{color:var(--fg)}
#tab-audit .metric.warn strong{color:var(--fg)}

/* Classification chart — grayscale */
#tab-audit .results-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
#tab-audit .class-chart{display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:12px;gap:2px}
#tab-audit .class-bar{transition:width .5s ease;border-radius:4px}
#tab-audit .class-legend{display:flex;flex-wrap:wrap;gap:12px}
#tab-audit .legend-item{display:flex;align-items:center;gap:6px;font-size:11px}
#tab-audit .legend-dot{width:10px;height:10px;border-radius:3px;flex:none}
#tab-audit .class-ootb{background:#ddd}
#tab-audit .class-proxied{background:#aaa}
#tab-audit .class-proxied-customized{background:#666}
#tab-audit .class-custom{background:#222}

/* Tech metrics */
#tab-audit .tech-list{display:flex;flex-direction:column}
#tab-audit .tech-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border-light)}
#tab-audit .tech-row:last-child{border-bottom:none}
#tab-audit .tech-label{font-size:12px;color:var(--fg-muted)}
#tab-audit .tech-value{font-weight:700;font-size:13px}

/* Core model + breakdown */
#tab-audit .core-model-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#tab-audit .core-stat{padding:14px;border-radius:8px;border:1px solid var(--border);text-align:center}
#tab-audit .core-stat strong{display:block;font-size:24px;font-weight:800;margin-bottom:4px}
#tab-audit .core-stat span{font-size:11px;color:var(--fg-muted)}

#tab-audit .breakdown-list{display:flex;flex-direction:column}
#tab-audit .breakdown-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-light)}
#tab-audit .breakdown-row:last-child{border-bottom:none}
#tab-audit .breakdown-label{flex:1;font-size:12px}
#tab-audit .breakdown-bar-wrap{flex:2;height:8px;border-radius:4px;background:rgba(127,127,127,.1);overflow:hidden}
#tab-audit .breakdown-bar{height:100%;border-radius:4px;background:var(--fg);opacity:.6;transition:width .5s ease}
#tab-audit .breakdown-count{font-weight:700;font-size:12px;min-width:30px;text-align:right}

/* Tables */
#tab-audit .table-wrap{max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:6px}
#tab-audit table{width:100%;border-collapse:collapse;font-size:11px}
#tab-audit th,#tab-audit td{padding:7px 10px;border-bottom:1px solid var(--border-light);text-align:left}
#tab-audit th{position:sticky;top:0;z-index:1;background:var(--panel);color:var(--fg-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
#tab-audit code{font-family:var(--vscode-editor-font-family,monospace);font-size:11px}

/* Recommendations — monochrome badges */
#tab-audit .rec-item{padding:12px 0;border-bottom:1px solid var(--border-light)}
#tab-audit .rec-item:last-child{border-bottom:none}
#tab-audit .rec-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
#tab-audit .rec-badge{padding:3px 9px;border-radius:10px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
#tab-audit .rec-badge.high{background:var(--fg);color:var(--vscode-editor-background)}
#tab-audit .rec-badge.medium{background:rgba(127,127,127,.25);color:var(--fg)}
#tab-audit .rec-badge.low{background:rgba(127,127,127,.1);color:var(--fg-muted)}
#tab-audit .rec-category{font-size:11px;color:var(--fg-muted);text-transform:capitalize}
#tab-audit .rec-finding{font-weight:600;font-size:12px;margin-bottom:4px}
#tab-audit .rec-detail{font-size:12px;color:var(--fg-muted);line-height:1.5}
#tab-audit .rec-affected{margin-top:6px;font-size:11px;color:var(--fg-muted)}

/* Duplicates */
#tab-audit .dup-item{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-light);align-items:center;font-size:12px}
#tab-audit .dup-item:last-child{border-bottom:none}
#tab-audit .dup-comp{font-weight:600}
#tab-audit .dup-site{color:var(--fg-muted);font-size:11px}
#tab-audit .dup-sim{font-weight:800;font-size:14px;text-align:center;min-width:50px;padding:4px 8px;border-radius:6px}
#tab-audit .dup-sim.exact{background:var(--fg);color:var(--vscode-editor-background)}
#tab-audit .dup-sim.near{background:rgba(127,127,127,.15);color:var(--fg)}

/* Cross-site */
#tab-audit .xsite-item{display:grid;grid-template-columns:1fr auto auto;gap:14px;padding:10px 0;border-bottom:1px solid var(--border-light);align-items:center;font-size:12px}
#tab-audit .xsite-item:last-child{border-bottom:none}
#tab-audit .xsite-name{font-weight:600}
#tab-audit .xsite-sites{color:var(--fg-muted);font-size:11px}
#tab-audit .xsite-badge{padding:3px 9px;border-radius:10px;font-size:10px;font-weight:700}
#tab-audit .xsite-badge.identical{background:var(--fg);color:var(--vscode-editor-background)}
#tab-audit .xsite-badge.partial{background:rgba(127,127,127,.15);color:var(--fg)}

/* Coverage table */
#tab-audit .cov-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:6px}
#tab-audit .cov-table{width:100%;border-collapse:collapse;font-size:12px}
#tab-audit .cov-table th{text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--fg-muted);border-bottom:2px solid var(--border);font-weight:700;position:sticky;top:0;z-index:1;background:var(--panel)}
#tab-audit .cov-table td{padding:8px 10px;border-bottom:1px solid var(--border-light)}
#tab-audit .cov-table .proj-name{font-weight:600}
#tab-audit .cov-status{display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:800;letter-spacing:.03em}
#tab-audit .cov-status.full{background:rgba(127,127,127,.12);color:var(--fg)}
#tab-audit .cov-status.partial{background:var(--fg);color:var(--vscode-editor-background);opacity:.6}
#tab-audit .cov-status.missing{background:var(--fg);color:var(--vscode-editor-background)}
#tab-audit .cov-sites{font-size:11px;color:var(--fg-muted)}
#tab-audit .cov-pages{font-weight:700;font-size:13px}

/* Footer */
#tab-audit .results-footer{display:flex;justify-content:space-between;padding:16px 0;border-top:1px solid var(--border);margin-top:12px;font-size:11px;color:var(--fg-muted)}

/* Empty state */
#tab-audit .empty-state{text-align:center;padding:36px 20px;color:var(--fg-muted)}
#tab-audit .empty-state h2{color:var(--fg);font-size:16px;text-transform:none;letter-spacing:0}
#tab-audit .empty-icon-wrap{margin-bottom:12px;opacity:.4}

/* Focus */
#tab-audit button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}

/* Responsive */
@media(max-width:800px){
  #tab-audit .metrics-grid{grid-template-columns:repeat(3,1fr)}
}
@media(max-width:700px){
  #tab-audit .metrics-grid{grid-template-columns:repeat(2,1fr)}
  #tab-audit .results-grid{grid-template-columns:1fr}
  #tab-audit .core-model-grid{grid-template-columns:1fr}
  #tab-audit .results-banner{flex-direction:column;gap:12px;align-items:flex-start}
  #tab-audit .dup-item,#tab-audit .xsite-item{grid-template-columns:1fr}
}

/* Reduced motion */
@media(prefers-reduced-motion:reduce){
  #tab-audit *{transition:none!important;animation:none!important}
}
`;
}

function auditClientScript(): string {
  return `
const $=id=>document.getElementById(id);
let selectedIds=new Set();
let contentPaths=[];
let cpEnabled=false;

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

function init(){
  if(!STATE.projects.length){
    $('aud-noproject').hidden=false;
    $('aud-configSection').hidden=true;
    return;
  }
  if(STATE.preselectId && STATE.projects.some(p=>p.id===STATE.preselectId)){
    selectedIds.add(STATE.preselectId);
  }else{
    STATE.projects.forEach(p=>selectedIds.add(p.id));
  }
  renderProjects();
  setupListeners();
}

function renderProjects(){
  const el=$('aud-projectList');
  $('aud-projectCount').textContent=selectedIds.size+'/'+STATE.projects.length+' selected';
  el.innerHTML=STATE.projects.map(p=>{
    const sel=selectedIds.has(p.id);
    return '<button type="button" class="project-item'+(sel?' selected':'')+'" data-id="'+p.id+'" role="checkbox" aria-checked="'+(sel?'true':'false')+'" aria-label="'+esc(p.artifactId)+' ('+esc(p.platformLabel)+')">'
      +'<div class="project-check" aria-hidden="true">'+(sel?'\\u2713':'')+'</div>'
      +'<div class="project-meta">'
      +'<div class="project-name">'+esc(p.artifactId)+'<span class="platform-badge '+p.platform+'">'+esc(p.platformLabel)+'</span></div>'
      +'<div class="project-detail">'+esc(p.groupId)+':'+esc(p.version)+' \\u00b7 '+p.modules.length+' modules \\u00b7 Java '+esc(p.javaVersion)+'</div>'
      +'</div></button>';
  }).join('');
  el.querySelectorAll('.project-item').forEach(item=>{
    item.onclick=()=>{
      const id=item.dataset.id;
      if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);
      renderProjects();
    };
  });
  const sa=$('aud-selectActions');
  if(STATE.projects.length<2)sa.hidden=true;else sa.hidden=false;
}

function renderContentPaths(){
  const el=$('aud-cpPaths');
  if(!contentPaths.length){el.innerHTML='<p class="muted">No folders selected.</p>';return;}
  el.innerHTML=contentPaths.map((p,i)=>
    '<div class="cp-path"><code>'+esc(p)+'</code><button type="button" class="remove" data-idx="'+i+'" aria-label="Remove '+esc(p.split('/').pop()||p)+'">\\u00d7</button></div>'
  ).join('');
  el.querySelectorAll('.remove').forEach(btn=>{
    btn.onclick=()=>{contentPaths.splice(parseInt(btn.dataset.idx),1);renderContentPaths();};
  });
}

function setupListeners(){
  const toggle=$('aud-cpToggle');
  toggle.onclick=()=>{cpEnabled=!cpEnabled;toggle.className='toggle-switch'+(cpEnabled?' on':'');toggle.setAttribute('aria-checked',cpEnabled?'true':'false');$('aud-cpConfig').hidden=!cpEnabled;};
  $('aud-browsePkgs').onclick=()=>vscode.postMessage({tab:'audit',type:'browsePackages'});
  const slider=$('aud-threshold');
  slider.oninput=()=>{$('aud-thresholdVal').textContent=slider.value+'%';slider.setAttribute('aria-valuetext',slider.value+'% similarity threshold');};
  $('aud-selectAll').onclick=()=>{STATE.projects.forEach(p=>selectedIds.add(p.id));renderProjects();};
  $('aud-deselectAll').onclick=()=>{selectedIds.clear();renderProjects();};
  $('aud-runBtn').onclick=runAudit;
  $('aud-exportBtn').onclick=()=>{$('aud-exportStatus').hidden=true;vscode.postMessage({tab:'audit',type:'exportExcel'});};
  $('aud-rerunBtn').onclick=()=>{$('aud-resultsSection').hidden=true;$('aud-configSection').hidden=false;$('aud-exportStatus').hidden=true;$('aud-auditError').hidden=true;$('aud-runBtn').focus();window.scrollTo(0,0);};
}

function runAudit(){
  if(!selectedIds.size){
    const err=$('aud-auditError');err.hidden=false;err.textContent='Select at least one project to run the audit.';
    return;
  }
  $('aud-auditError').hidden=true;
  $('aud-runBtn').disabled=true;
  $('aud-progressArea').hidden=false;
  $('aud-progressFill').style.width='0%';
  $('aud-progressFill').className='progress-fill indeterminate';
  $('aud-progressText').textContent='Scanning projects and classifying components...';
  vscode.postMessage({
    tab:'audit',
    type:'runAudit',
    projectIds:[...selectedIds],
    contentPaths:cpEnabled?contentPaths:[],
    duplicateThreshold:parseInt($('aud-threshold').value)
  });
}

function renderResults(r){
  $('aud-configSection').hidden=true;
  $('aud-resultsSection').hidden=false;
  $('aud-progressArea').hidden=true;
  $('aud-runBtn').disabled=false;

  const s=r.summary;
  const projNames=r.projects.map(p=>p.artifactId).join(', ');
  $('aud-resultsSub').textContent=projNames+' \\u00b7 '+s.totalComponents+' components \\u00b7 '+s.totalSites+' site(s)';

  // Metrics
  $('aud-metricsGrid').innerHTML=[
    metric(s.totalComponents,'Components','highlight'),
    metric(s.totalSites,'Sites',''),
    metric(s.duplicatePairs,'Duplicate Pairs',s.duplicatePairs>0?'warn':''),
    metric(s.unusedComponents,'Unused',s.unusedComponents>0?'warn':''),
    metric(r.recommendations.length,'Recommendations',''),
  ].join('');

  // Classification chart
  const total=s.totalComponents||1;
  const cls=[
    {key:'ootb',label:'Pure OOTB',count:s.byClassification.ootb,cls:'class-ootb'},
    {key:'proxied',label:'Proxied',count:s.byClassification.proxied,cls:'class-proxied'},
    {key:'proxied-customized',label:'Proxied + Customized',count:s.byClassification['proxied-customized'],cls:'class-proxied-customized'},
    {key:'custom',label:'Pure Custom',count:s.byClassification.custom,cls:'class-custom'},
  ];
  $('aud-classChart').innerHTML=cls.map(c=>
    '<div class="class-bar '+c.cls+'" style="width:'+Math.max((c.count/total*100),c.count>0?3:0)+'%" title="'+c.label+': '+c.count+'"></div>'
  ).join('');
  $('aud-classLegend').innerHTML=cls.map(c=>
    '<div class="legend-item"><div class="legend-dot '+c.cls+'"></div>'+c.label+': <strong>'+c.count+'</strong> ('+Math.round(c.count/total*100)+'%)</div>'
  ).join('');

  // Tech metrics
  $('aud-techMetrics').innerHTML=[
    techRow('HTL Components',s.htlComponents),
    techRow('JSP Components (Legacy)',s.jspComponents),
    techRow('With Sling Model',s.withSlingModel),
    techRow('With Dialog',s.withDialog),
    techRow('Without Dialog',s.withoutDialog),
    techRow('Avg Dialog Fields',s.averageDialogFields),
    s.migrationReadiness!==null?techRow('Migration Readiness',s.migrationReadiness+'%'):'',
    s.contentPackagesAnalyzed>0?techRow('Content Pkgs Analyzed',s.contentPackagesAnalyzed):'',
  ].filter(Boolean).join('');

  // Core Component Sling Models
  const coreTotal=s.withCoreModelOverride+s.coreProxiesWithoutModelOverride;
  if(coreTotal>0){
    $('aud-coreModelCard').hidden=false;
    $('aud-coreModelContent').innerHTML='<div class="core-model-grid">'
      +'<div class="core-stat override"><strong>'+s.withCoreModelOverride+'</strong><span>Core Model Overrides</span></div>'
      +'<div class="core-stat ootb"><strong>'+s.coreProxiesWithoutModelOverride+'</strong><span>Using OOTB Model</span></div>'
      +'</div>'
      +'<p class="muted">Of '+coreTotal+' Core Component proxies, '+s.withCoreModelOverride+' have project-level Sling Model overrides.</p>';
  }else{$('aud-coreModelCard').hidden=true;}

  // Site breakdown
  const sites=Object.entries(s.bySite).sort((a,b)=>b[1]-a[1]);
  if(sites.length>0){
    $('aud-siteBreakdownCard').hidden=false;
    const maxSite=Math.max(...sites.map(e=>e[1]),1);
    $('aud-siteBreakdownContent').innerHTML=sites.map(([site,count])=>{
      const pct=Math.round(count/maxSite*100);
      return '<div class="breakdown-row"><span class="breakdown-label">'+esc(site)+'</span><div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:'+pct+'%"></div></div><span class="breakdown-count">'+count+'</span></div>';
    }).join('');
  }else{$('aud-siteBreakdownCard').hidden=true;}

  // Usage Coverage
  if(r.usageCoverage&&r.usageCoverage.length){
    $('aud-usageCoverageCard').hidden=false;
    const hasPackages=s.contentPackagesAnalyzed>0;
    const missing=r.usageCoverage.filter(c=>!c.hasCoverage);
    const partial=r.usageCoverage.filter(c=>c.isPartial);
    let hint='Content package coverage across '+r.usageCoverage.length+' project(s).';
    if(!hasPackages)hint='No content packages provided. Provide CRX packages for production usage data.';
    else if(missing.length)hint+=(' '+missing.length+' project(s) missing content packages.');
    if(partial.length)hint+=(' '+partial.length+' project(s) with partial site coverage.');
    $('aud-coverageHint').textContent=hint;

    let covHtml='<div class="cov-scroll"><table class="cov-table" aria-label="Usage coverage by project"><thead><tr><th>Project</th><th>Sites</th><th>Coverage</th><th>Covered Sites</th><th>Pages Found</th><th>Missing Sites</th></tr></thead><tbody>';
    for(const cov of r.usageCoverage){
      const status=!hasPackages?'missing':cov.hasCoverage?(cov.isPartial?'partial':'full'):'missing';
      const statusLabel=!hasPackages?'No Packages':cov.hasCoverage?(cov.isPartial?'Partial':'Full'):'Missing';
      covHtml+='<tr>'
        +'<td class="proj-name">'+esc(cov.projectArtifactId)+'</td>'
        +'<td class="cov-sites">'+esc(cov.sites.join(', '))+'</td>'
        +'<td><span class="cov-status '+status+'">'+statusLabel+'</span></td>'
        +'<td class="cov-sites">'+(cov.coveredSites.length?esc(cov.coveredSites.join(', ')):'\\u2014')+'</td>'
        +'<td class="cov-pages">'+cov.totalPagesFound+'</td>'
        +'<td class="cov-sites">'+(cov.uncoveredSites.length?esc(cov.uncoveredSites.join(', ')):'\\u2014')+'</td>'
        +'</tr>';
    }
    covHtml+='</tbody></table></div>';
    $('aud-usageCoverageContent').innerHTML=covHtml;
  }else{$('aud-usageCoverageCard').hidden=true;}

  // Duplicates
  if(r.duplicates.length){
    $('aud-duplicatesCard').hidden=false;
    $('aud-duplicatesContent').innerHTML=r.duplicates.slice(0,20).map(d=>
      '<div class="dup-item">'
      +'<div><div class="dup-comp">'+esc(d.componentA)+'</div><div class="dup-site">'+esc(d.siteA)+'</div></div>'
      +'<div><div class="dup-comp">'+esc(d.componentB)+'</div><div class="dup-site">'+esc(d.siteB)+'</div></div>'
      +'<div class="dup-sim '+(d.similarity===100?'exact':'near')+'">'+d.similarity+'%</div>'
      +'</div>'
    ).join('')+(r.duplicates.length>20?'<p class="muted">...and '+(r.duplicates.length-20)+' more. Export to Excel for the full list.</p>':'');
  }else{$('aud-duplicatesCard').hidden=true;}

  // Cross-site reuse
  if(r.crossSiteReuse.length){
    $('aud-crossSiteCard').hidden=false;
    $('aud-crossSiteContent').innerHTML=r.crossSiteReuse.slice(0,15).map(e=>
      '<div class="xsite-item">'
      +'<div><div class="xsite-name">'+esc(e.leafName)+'</div><div class="xsite-sites">'+esc(e.sites.join(', '))+'</div></div>'
      +'<span>'+e.sites.length+' sites</span>'
      +'<span class="xsite-badge '+(e.identical?'identical':'partial')+'">'+(e.identical?'Identical':''+e.similarity+'%')+'</span>'
      +'</div>'
    ).join('')+(r.crossSiteReuse.length>15?'<p class="muted">...and '+(r.crossSiteReuse.length-15)+' more. Export to Excel for the full list.</p>':'');
  }else{$('aud-crossSiteCard').hidden=true;}

  // Recommendations
  if(r.recommendations.length){
    $('aud-recsCard').hidden=false;
    $('aud-recsContent').innerHTML=r.recommendations.map(rec=>
      '<div class="rec-item">'
      +'<div class="rec-head"><span class="rec-badge '+rec.impact+'">'+rec.impact+'</span><span class="rec-category">'+esc(rec.category)+'</span></div>'
      +'<div class="rec-finding">'+esc(rec.finding)+'</div>'
      +'<div class="rec-detail">'+esc(rec.recommendation)+'</div>'
      +(rec.affectedComponents.length?'<div class="rec-affected">Affected: '+rec.affectedComponents.slice(0,5).map(c=>'<code>'+esc(c)+'</code>').join(', ')+(rec.affectedComponents.length>5?' +\\u2009'+(rec.affectedComponents.length-5)+' more':'')+'</div>':'')
      +'</div>'
    ).join('');
  }else{$('aud-recsCard').hidden=true;}

  // Top used
  if(r.topUsed.length){
    $('aud-topUsedCard').hidden=false;
    $('aud-topUsedContent').innerHTML='<table><thead><tr><th>Resource Type</th><th>Site</th><th>Usage</th></tr></thead><tbody>'
      +r.topUsed.map(c=>'<tr><td><code>'+esc(c.resourceType)+'</code></td><td>'+esc(c.site)+'</td><td><strong>'+c.usageCount+'</strong></td></tr>').join('')
      +'</tbody></table>';
  }else{$('aud-topUsedCard').hidden=true;}

  // Unused
  if(r.topUnused.length){
    $('aud-unusedCard').hidden=false;
    const classLabel={ootb:'OOTB',proxied:'Proxied','proxied-customized':'Proxied+Custom',custom:'Custom'};
    $('aud-unusedContent').innerHTML='<table><thead><tr><th>Resource Type</th><th>Site</th><th>Classification</th></tr></thead><tbody>'
      +r.topUnused.map(c=>'<tr><td><code>'+esc(c.resourceType)+'</code></td><td>'+esc(c.site)+'</td><td>'+(classLabel[c.classification]||c.classification)+'</td></tr>').join('')
      +'</tbody></table>'
      +(s.unusedComponents>20?'<p class="muted" style="padding:8px 10px">Showing 20 of '+s.unusedComponents+'. Export for full list.</p>':'');
  }else{$('aud-unusedCard').hidden=true;}

  $('aud-generatedAt').textContent=r.generatedAt;
  window.scrollTo({top:0,behavior:'smooth'});
}

function metric(val,label,cls){
  return '<div class="metric'+(cls?' '+cls:'')+'"><strong>'+val+'</strong><span>'+label+'</span></div>';
}
function techRow(label,val){
  return '<div class="tech-row"><span class="tech-label">'+label+'</span><span class="tech-value">'+val+'</span></div>';
}

window.addEventListener('message',e=>{
  const m=e.data;if(!m||m.tab!=='audit')return;
  if(m.type==='packagesSelected'){
    const newPaths=(m.paths||[]).filter(p=>!contentPaths.includes(p));
    contentPaths.push(...newPaths);
    renderContentPaths();
  }
  if(m.type==='auditProgress'){
    $('aud-progressArea').hidden=false;
    $('aud-progressText').textContent=m.detail||'Processing...';
    if(m.step==='scanning'){$('aud-progressFill').style.width='40%';$('aud-progressFill').className='progress-fill';}
    if(m.step==='generating'){$('aud-progressFill').style.width='80%';$('aud-progressFill').className='progress-fill';}
  }
  if(m.type==='auditComplete'){
    $('aud-progressFill').style.width='100%';
    $('aud-progressFill').className='progress-fill';
    setTimeout(()=>{renderResults(m.result);$('aud-resultsSection').focus();},300);
  }
  if(m.type==='auditError'){
    $('aud-progressArea').hidden=true;
    $('aud-runBtn').disabled=false;
    const err=$('aud-auditError');err.hidden=false;err.textContent='Audit failed: '+m.error;
    err.focus();
  }
  if(m.type==='exportComplete'){
    const st=$('aud-exportStatus');st.hidden=false;st.className='export-status ok';
    st.textContent='\\u2713 Report saved successfully \\u2014 '+m.path.split('/').pop();
  }
});

init();
`;
}
