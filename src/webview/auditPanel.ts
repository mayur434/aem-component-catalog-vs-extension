/**
 * Enterprise audit configuration & results panel — DEPT branded.
 *
 * Provides an interactive webview for running the AEM Component Tech Audit:
 * project selection, content-package configuration, duplicate threshold,
 * live progress, inline results dashboard, and one-click Excel export.
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { detectAllProjects, type ProjectInfo } from '../scanner/projectDetector';
import { runAudit } from '../audit/auditEngine';
import { generateExcelReport } from '../audit/excelReporter';
import type { AuditResult } from '../audit/types';
import { projectId, dateStamp } from '../utils/webviewHelpers';

let currentPanel: vscode.WebviewPanel | undefined;
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

export function openAuditPanel(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'aemComponentAudit',
    'DEPT — AEM Component Tech Audit',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  currentPanel = panel;
  const resources = vscode.Uri.joinPath(context.extensionUri, 'resources');
  panel.iconPath = vscode.Uri.joinPath(resources, 'icon.svg');

  panel.webview.html = renderPanel();

  panel.webview.onDidReceiveMessage(
    async (raw: unknown) => {
      const msg = raw as Record<string, unknown>;
      if (!msg) return;
      if (msg.type === 'runAudit') await handleRunAudit(panel, msg);
      else if (msg.type === 'browsePackages') await handleBrowsePackages(panel);
      else if (msg.type === 'exportExcel') await handleExportExcel(panel);
      else if (msg.type === 'openFile') handleOpenFile(msg);
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
      type: 'packagesSelected',
      paths: folders.map((f) => f.fsPath),
    });
  }
}

async function handleRunAudit(panel: vscode.WebviewPanel, msg: Record<string, unknown>): Promise<void> {
  const selectedIds = msg.projectIds as string[];
  const contentPaths = (msg.contentPaths as string[]) ?? [];
  const threshold = (msg.duplicateThreshold as number) ?? 50;

  const allProjects = discoverProjects();
  const selected = allProjects.filter((p) =>
    selectedIds.includes(projectId(p.root)),
  );

  if (selected.length === 0) {
    panel.webview.postMessage({ type: 'auditError', error: 'No projects selected.' });
    return;
  }

  panel.webview.postMessage({ type: 'auditProgress', step: 'scanning', detail: `Scanning ${selected.length} project(s)...` });

  try {
    const result = runAudit(selected, {
      contentPackagePaths: contentPaths,
      duplicateThreshold: threshold,
    });
    lastAuditResult = result;

    panel.webview.postMessage({ type: 'auditProgress', step: 'generating', detail: 'Preparing results...' });

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

    panel.webview.postMessage({ type: 'auditComplete', result: serializable });
  } catch (err) {
    panel.webview.postMessage({
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
    panel.webview.postMessage({ type: 'exportComplete', path: reportPath });
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

function discoverProjects(): ProjectInfo[] {
  const projects = new Map<string, ProjectInfo>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const project of detectAllProjects(folder.uri.fsPath)) {
      projects.set(path.resolve(project.root), project);
    }
  }
  return [...projects.values()].sort((a, b) => a.root.localeCompare(b.root));
}

function buildProjectState(): AuditProject[] {
  return discoverProjects().map((p) => ({
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

function renderPanel(): string {
  const nonce = crypto.randomBytes(18).toString('base64');
  const projects = buildProjectState();
  const stateJson = JSON.stringify({ projects }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>DEPT — AEM Component Tech Audit</title>
<style>${auditStyles()}</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div>
      <p class="eyebrow">AEM COMPONENT CATALOG</p>
      <h1>Component Tech Audit</h1>
      <p class="subtitle">Deep-scan AEMaaCS &amp; AMS projects — classification, duplicates, usage analysis, Sling Model overrides, and actionable recommendations.</p>
    </div>
    <span class="brand-tag">DEPT</span>
  </header>

  <section class="card" id="noproject" hidden role="alert">
    <div class="empty-state">
      <div class="empty-icon-wrap"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>
      <h2>No AEM Projects Found</h2>
      <p>Open an AEM Project Archetype workspace (AEMaaCS or AMS) to run the tech audit.</p>
    </div>
  </section>

  <div id="configSection">
    <section class="card">
      <div class="card-header"><h2>Projects</h2><span class="card-count" id="projectCount"></span></div>
      <p class="hint">Select projects to include in the audit. Both AEMaaCS and AEM AMS are supported.</p>
      <div class="select-actions" id="selectActions">
        <button type="button" class="link-btn" id="selectAll">Select all</button>
        <span class="select-sep">|</span>
        <button type="button" class="link-btn" id="deselectAll">Deselect all</button>
      </div>
      <div id="projectList" class="project-list" role="group" aria-label="Project selection"></div>
    </section>

    <section class="card">
      <div class="card-header"><h2>Content Packages</h2><span class="card-badge optional">Optional</span></div>
      <p class="hint">Provide CRX content package <strong>.zip</strong> files to analyze real production usage data. Without this, usage counts will be zero.</p>
      <div class="toggle-row">
        <button type="button" class="toggle-switch" id="cpToggle" role="switch" aria-checked="false" aria-label="Analyze content packages">
          <span class="track" aria-hidden="true"></span>
          <span>Analyze content packages</span>
        </button>
      </div>
      <div id="cpConfig" class="cp-config" hidden>
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
        <div class="cp-paths" id="cpPaths">
          <p class="muted">No folders selected.</p>
        </div>
        <button type="button" class="ghost-btn" id="browsePkgs">Browse for folder</button>
      </div>
    </section>

    <section class="card">
      <div class="card-header"><h2>Configuration</h2></div>
      <div class="config-grid">
        <div class="config-item">
          <label class="field-label" for="threshold">Duplicate detection threshold</label>
          <div class="slider-row">
            <input type="range" id="threshold" min="30" max="100" value="50" step="5"/>
            <span id="thresholdVal" class="slider-val">50%</span>
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
      <div id="progressArea" class="progress-area" hidden>
        <div class="progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" id="progressFill"></div></div>
        <p id="progressText" class="progress-text" aria-live="polite">Initializing...</p>
      </div>
      <div id="auditError" class="audit-error" hidden role="alert"></div>
      <button type="button" class="primary run-btn" id="runBtn">Run Component Audit</button>
    </div>
  </div>

  <div id="resultsSection" hidden tabindex="-1">
    <div class="results-banner">
      <div class="results-banner-left">
        <div>
          <p class="eyebrow">AUDIT RESULTS</p>
          <p class="results-sub" id="resultsSub"></p>
        </div>
      </div>
      <div class="results-actions">
        <button type="button" class="btn-secondary" id="rerunBtn">Run Again</button>
        <button type="button" class="btn-primary" id="exportBtn">Export Excel Report</button>
      </div>
    </div>
    <div id="exportStatus" class="export-status" hidden></div>

    <section class="metrics-grid" id="metricsGrid"></section>

    <div class="results-grid">
      <section class="card" id="classificationCard">
        <h3>Classification Breakdown</h3>
        <div id="classChart" class="class-chart"></div>
        <div id="classLegend" class="class-legend"></div>
      </section>

      <section class="card" id="techMetricsCard">
        <h3>Technical Metrics</h3>
        <div id="techMetrics" class="tech-list"></div>
      </section>
    </div>

    <div class="results-grid">
      <section class="card" id="coreModelCard">
        <h3>Core Component Sling Models</h3>
        <div id="coreModelContent"></div>
      </section>

      <section class="card" id="siteBreakdownCard">
        <h3>Components by Site</h3>
        <div id="siteBreakdownContent" class="breakdown-list"></div>
      </section>
    </div>

    <section class="card" id="usageCoverageCard" hidden>
      <h3>Usage Coverage Summary</h3>
      <p class="hint" id="coverageHint"></p>
      <div id="usageCoverageContent"></div>
    </section>

    <section class="card" id="duplicatesCard">
      <h3>Duplicate Analysis</h3>
      <div id="duplicatesContent"></div>
    </section>

    <section class="card" id="crossSiteCard">
      <h3>Cross-Site Reuse</h3>
      <div id="crossSiteContent"></div>
    </section>

    <section class="card" id="recsCard">
      <h3>Recommendations</h3>
      <div id="recsContent"></div>
    </section>

    <div class="results-grid">
      <section class="card" id="topUsedCard">
        <h3>Top Used Components</h3>
        <div id="topUsedContent" class="table-wrap"></div>
      </section>

      <section class="card" id="unusedCard">
        <h3>Unused Components</h3>
        <div id="unusedContent" class="table-wrap"></div>
      </section>
    </div>

    <div class="results-footer">
      <span>Prepared by DEPT</span>
      <span id="generatedAt"></span>
    </div>
  </div>
</div>
<script nonce="${nonce}">const STATE=${stateJson};${auditClientScript()}</script>
</body>
</html>`;
}

function auditStyles(): string {
  return `
*{box-sizing:border-box}
:root{
  --panel:var(--vscode-sideBar-background);
  --fg:var(--vscode-editor-foreground);
  --fg-muted:var(--vscode-descriptionForeground);
  --accent:var(--vscode-textLink-foreground);
  --card-bg:var(--vscode-editorWidget-background,var(--panel));
  --border:var(--vscode-panel-border,rgba(127,127,127,.18));
  --border-light:var(--vscode-widget-border,rgba(127,127,127,.1));
  --input-bg:var(--vscode-input-background);
  --btn-bg:var(--vscode-button-background);
  --btn-fg:var(--vscode-button-foreground);
  --btn-hover:var(--vscode-button-hoverBackground);
  --btn2-bg:var(--vscode-button-secondaryBackground);
  --btn2-fg:var(--vscode-button-secondaryForeground);
  --btn2-hover:var(--vscode-button-secondaryHoverBackground)
}
body{font-family:var(--vscode-font-family);color:var(--fg);background:var(--vscode-editor-background);margin:0;padding:28px;font-size:13px}
.wrap{max-width:960px;margin:0 auto}

/* Hero header — matches dashboard & config panels */
.hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding-bottom:22px;border-bottom:1px solid var(--border);margin-bottom:18px}
.eyebrow{margin-bottom:6px;color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0 0 6px;font-size:26px}
.subtitle{color:var(--fg-muted);margin:0;font-size:13px;line-height:1.5}
.brand-tag{border-radius:999px;padding:6px 10px;font-size:11px;font-weight:600;white-space:nowrap;color:var(--fg-muted);border:1px solid var(--border);background:var(--card-bg)}

/* Cards */
h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-muted);margin:0}
h3{font-size:14px;margin:0 0 14px;color:var(--fg);font-weight:600}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:12px}
.card-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.card-count{font-size:11px;font-weight:700;color:var(--fg);background:rgba(127,127,127,.12);padding:2px 8px;border-radius:8px}
.card-badge{font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600}
.card-badge.optional{color:var(--fg-muted);background:rgba(127,127,127,.1)}
.hint{color:var(--fg-muted);font-size:12px;margin:0 0 12px}
.muted{color:var(--fg-muted);font-size:12px;margin:6px 0 0}
.field-label{display:block;font-size:12px;color:var(--fg-muted);margin:0 0 6px;font-weight:600}

/* Select actions */
.select-actions{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.link-btn{background:none;border:none;color:var(--accent);cursor:pointer;font:inherit;font-size:11px;padding:2px 4px;border-radius:3px}
.link-btn:hover{text-decoration:underline}
.link-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}
.select-sep{color:var(--fg-muted);font-size:11px}

/* Project list */
.project-list{display:flex;flex-direction:column;gap:6px}
.project-item{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .12s;background:none;width:100%;text-align:left;font:inherit;color:inherit}
.project-item:hover{border-color:var(--vscode-focusBorder);background:rgba(127,127,127,.04)}
.project-item:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
.project-item.selected{border-color:var(--fg);background:rgba(127,127,127,.08)}
.project-check{flex:none;width:18px;height:18px;border-radius:4px;border:2px solid rgba(127,127,127,.4);display:flex;align-items:center;justify-content:center;font-size:11px;color:transparent;transition:.12s}
.project-item.selected .project-check{border-color:var(--fg);background:var(--fg);color:var(--vscode-editor-background)}
.project-meta{flex:1;min-width:0}
.project-name{font-weight:600;font-size:13px}
.project-detail{color:var(--fg-muted);font-size:11px;margin-top:2px}
.platform-badge{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:.03em;margin-left:6px;background:rgba(127,127,127,.12);color:var(--fg)}

/* Toggle */
.toggle-row{margin-bottom:10px}
.toggle-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none;background:none;border:none;padding:4px 0;font:inherit;color:inherit}
.toggle-switch:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px;border-radius:4px}
.toggle-switch .track{flex:none;width:34px;height:20px;border-radius:20px;background:rgba(127,127,127,.35);position:relative;transition:.15s}
.toggle-switch .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
.toggle-switch.on .track{background:var(--btn-bg)}
.toggle-switch.on .track::after{transform:translateX(14px)}
.cp-config{margin-top:10px}
.cp-guide{margin-bottom:14px;padding:14px 16px;border-radius:8px;border:1px solid var(--border);background:rgba(127,127,127,.04)}
.guide-title{font-weight:700;font-size:12px;margin:0 0 8px}
.guide-steps{margin:0 0 10px;padding-left:20px;font-size:12px;line-height:1.8;color:var(--fg-muted)}
.guide-steps li{margin-bottom:2px}
.guide-steps strong{color:var(--fg)}
.guide-steps code{background:rgba(127,127,127,.12);padding:1px 5px;border-radius:3px;font-size:11px}
.guide-note{margin:0;font-size:11px;color:var(--fg-muted);line-height:1.6;border-top:1px solid var(--border-light);padding-top:10px}
.guide-note code{background:rgba(127,127,127,.12);padding:1px 5px;border-radius:3px;font-size:10px}
.cp-paths{margin-bottom:10px;padding:8px 12px;border-radius:6px;background:var(--input-bg);min-height:36px}
.cp-path{display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 0}
.cp-path .remove{cursor:pointer;color:var(--fg-muted);font-size:14px;border:none;background:none;padding:0 4px}
.cp-path .remove:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px;border-radius:2px}
.ghost-btn{padding:7px 14px;border:1px solid var(--vscode-button-border,var(--border));border-radius:4px;background:var(--btn2-bg);color:var(--btn2-fg);cursor:pointer;font:inherit;font-size:12px}
.ghost-btn:hover{background:var(--btn2-hover)}
.ghost-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}

/* Derivation box */
.derivation-box{margin-top:12px;padding:14px 16px;border-radius:8px;border:1px solid var(--border);background:rgba(127,127,127,.04)}
.derivation-title{font-weight:700;font-size:12px;margin:0 0 8px}
.derivation-text{font-size:12px;color:var(--fg-muted);margin:0 0 8px;line-height:1.7}
.derivation-text strong{color:var(--fg)}
.derivation-text code{background:rgba(127,127,127,.12);padding:1px 5px;border-radius:3px;font-size:11px}
.derivation-formula{font-size:12px;font-weight:600;color:var(--fg);margin:8px 0;padding:8px 12px;border-radius:6px;background:rgba(127,127,127,.08);font-family:var(--vscode-editor-font-family,monospace)}

/* Slider */
.slider-row{display:flex;align-items:center;gap:12px}
.slider-row input[type=range]{flex:1;-webkit-appearance:none;height:5px;border-radius:3px;background:rgba(127,127,127,.25);outline:none}
.slider-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:var(--fg);cursor:pointer;border:2px solid var(--vscode-editor-background);box-shadow:0 1px 3px rgba(0,0,0,.15)}
.slider-row input[type=range]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px;border-radius:3px}
.slider-val{font-weight:700;font-size:14px;min-width:36px;text-align:right}
.config-grid{display:flex;flex-direction:column;gap:16px}

/* Buttons — VS Code native styling */
.btn-primary{padding:8px 18px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--btn-bg);color:var(--btn-fg);font:inherit;font-weight:600;font-size:12px;cursor:pointer}
.btn-primary:hover{background:var(--btn-hover)}
.btn-primary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}
.btn-secondary{padding:8px 18px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--btn2-bg);color:var(--btn2-fg);font:inherit;font-size:12px;cursor:pointer}
.btn-secondary:hover{background:var(--btn2-hover)}
.btn-secondary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}

/* Run button & progress */
.run-section{margin:22px 0;display:flex;flex-direction:column;align-items:center;gap:14px}
.run-btn{padding:14px 40px;font-size:14px;border-radius:4px;background:var(--btn-bg);border:1px solid var(--vscode-button-border,transparent);color:var(--btn-fg);font-weight:700;cursor:pointer;transition:all .15s;letter-spacing:.02em}
.run-btn:hover{background:var(--btn-hover)}
.run-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.run-btn:disabled{opacity:.4;cursor:default}
.progress-area{width:100%;max-width:500px}
.progress-bar{height:5px;border-radius:3px;background:rgba(127,127,127,.15);overflow:hidden}
.progress-fill{height:100%;border-radius:3px;background:var(--btn-bg);width:0%;transition:width .4s ease}
.progress-fill.indeterminate{width:100%;animation:shimmer 1.5s infinite}
@keyframes shimmer{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}
.progress-text{text-align:center;font-size:12px;color:var(--fg-muted);margin:8px 0 0}
.audit-error{padding:12px 16px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid var(--border);background:rgba(127,127,127,.06);color:var(--fg);text-align:center;max-width:500px;width:100%}

/* Results banner — themed card */
.results-banner{display:flex;align-items:center;justify-content:space-between;margin:20px 0 14px;padding:16px 18px;background:var(--panel);border:1px solid var(--border);border-radius:10px}
.results-banner-left{display:flex;align-items:center;gap:14px}
.results-banner .eyebrow{margin-bottom:0}
.results-sub{font-size:11px;color:var(--fg-muted);margin:4px 0 0}
.results-actions{display:flex;gap:8px;align-items:center}

/* Export status */
.export-status{padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.export-status.ok{background:rgba(127,127,127,.08);color:var(--fg);border:1px solid var(--border)}
.export-status.err{background:rgba(127,127,127,.08);color:var(--fg);border:1px solid var(--border)}

/* Metrics grid — matches dashboard */
.metrics-grid{display:grid;grid-template-columns:repeat(5,minmax(100px,1fr));gap:10px;margin-bottom:14px}
.metric{display:flex;flex-direction:column;gap:3px;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
.metric strong{font-size:22px;font-weight:800}
.metric span{color:var(--fg-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em}
.metric.highlight strong{color:var(--fg)}
.metric.warn strong{color:var(--fg)}

/* Classification chart — grayscale */
.results-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.class-chart{display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:12px;gap:2px}
.class-bar{transition:width .5s ease;border-radius:4px}
.class-legend{display:flex;flex-wrap:wrap;gap:12px}
.legend-item{display:flex;align-items:center;gap:6px;font-size:11px}
.legend-dot{width:10px;height:10px;border-radius:3px;flex:none}
.class-ootb{background:#ddd}
.class-proxied{background:#aaa}
.class-proxied-customized{background:#666}
.class-custom{background:#222}

/* Tech metrics */
.tech-list{display:flex;flex-direction:column}
.tech-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border-light)}
.tech-row:last-child{border-bottom:none}
.tech-label{font-size:12px;color:var(--fg-muted)}
.tech-value{font-weight:700;font-size:13px}

/* Core model + breakdown */
.core-model-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.core-stat{padding:14px;border-radius:8px;border:1px solid var(--border);text-align:center}
.core-stat strong{display:block;font-size:24px;font-weight:800;margin-bottom:4px}
.core-stat span{font-size:11px;color:var(--fg-muted)}

.breakdown-list{display:flex;flex-direction:column}
.breakdown-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-light)}
.breakdown-row:last-child{border-bottom:none}
.breakdown-label{flex:1;font-size:12px}
.breakdown-bar-wrap{flex:2;height:8px;border-radius:4px;background:rgba(127,127,127,.1);overflow:hidden}
.breakdown-bar{height:100%;border-radius:4px;background:var(--fg);opacity:.6;transition:width .5s ease}
.breakdown-count{font-weight:700;font-size:12px;min-width:30px;text-align:right}

/* Tables */
.table-wrap{max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:6px}
table{width:100%;border-collapse:collapse;font-size:11px}
th,td{padding:7px 10px;border-bottom:1px solid var(--border-light);text-align:left}
th{position:sticky;top:0;z-index:1;background:var(--panel);color:var(--fg-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
code{font-family:var(--vscode-editor-font-family,monospace);font-size:11px}

/* Recommendations — monochrome badges */
.rec-item{padding:12px 0;border-bottom:1px solid var(--border-light)}
.rec-item:last-child{border-bottom:none}
.rec-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.rec-badge{padding:3px 9px;border-radius:10px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
.rec-badge.high{background:var(--fg);color:var(--vscode-editor-background)}
.rec-badge.medium{background:rgba(127,127,127,.25);color:var(--fg)}
.rec-badge.low{background:rgba(127,127,127,.1);color:var(--fg-muted)}
.rec-category{font-size:11px;color:var(--fg-muted);text-transform:capitalize}
.rec-finding{font-weight:600;font-size:12px;margin-bottom:4px}
.rec-detail{font-size:12px;color:var(--fg-muted);line-height:1.5}
.rec-affected{margin-top:6px;font-size:11px;color:var(--fg-muted)}

/* Duplicates */
.dup-item{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-light);align-items:center;font-size:12px}
.dup-item:last-child{border-bottom:none}
.dup-comp{font-weight:600}
.dup-site{color:var(--fg-muted);font-size:11px}
.dup-sim{font-weight:800;font-size:14px;text-align:center;min-width:50px;padding:4px 8px;border-radius:6px}
.dup-sim.exact{background:var(--fg);color:var(--vscode-editor-background)}
.dup-sim.near{background:rgba(127,127,127,.15);color:var(--fg)}

/* Cross-site */
.xsite-item{display:grid;grid-template-columns:1fr auto auto;gap:14px;padding:10px 0;border-bottom:1px solid var(--border-light);align-items:center;font-size:12px}
.xsite-item:last-child{border-bottom:none}
.xsite-name{font-weight:600}
.xsite-sites{color:var(--fg-muted);font-size:11px}
.xsite-badge{padding:3px 9px;border-radius:10px;font-size:10px;font-weight:700}
.xsite-badge.identical{background:var(--fg);color:var(--vscode-editor-background)}
.xsite-badge.partial{background:rgba(127,127,127,.15);color:var(--fg)}

/* Coverage table */
.cov-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:6px}
.cov-table{width:100%;border-collapse:collapse;font-size:12px}
.cov-table th{text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--fg-muted);border-bottom:2px solid var(--border);font-weight:700;position:sticky;top:0;z-index:1;background:var(--panel)}
.cov-table td{padding:8px 10px;border-bottom:1px solid var(--border-light)}
.cov-table .proj-name{font-weight:600}
.cov-status{display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:800;letter-spacing:.03em}
.cov-status.full{background:rgba(127,127,127,.12);color:var(--fg)}
.cov-status.partial{background:var(--fg);color:var(--vscode-editor-background);opacity:.6}
.cov-status.missing{background:var(--fg);color:var(--vscode-editor-background)}
.cov-sites{font-size:11px;color:var(--fg-muted)}
.cov-pages{font-weight:700;font-size:13px}

/* Footer */
.results-footer{display:flex;justify-content:space-between;padding:16px 0;border-top:1px solid var(--border);margin-top:12px;font-size:11px;color:var(--fg-muted)}

/* Empty state */
.empty-state{text-align:center;padding:36px 20px;color:var(--fg-muted)}
.empty-state h2{color:var(--fg);font-size:16px;text-transform:none;letter-spacing:0}
.empty-icon-wrap{margin-bottom:12px;opacity:.4}

/* Focus */
button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:1px}

/* Responsive */
@media(max-width:900px){
  body{padding:18px}
  .hero{flex-direction:column}
}
@media(max-width:800px){
  .metrics-grid{grid-template-columns:repeat(3,1fr)}
}
@media(max-width:700px){
  .metrics-grid{grid-template-columns:repeat(2,1fr)}
  .results-grid{grid-template-columns:1fr}
  .core-model-grid{grid-template-columns:1fr}
  .results-banner{flex-direction:column;gap:12px;align-items:flex-start}
  .dup-item,.xsite-item{grid-template-columns:1fr}
}

/* Reduced motion */
@media(prefers-reduced-motion:reduce){
  *{transition:none!important;animation:none!important}
}
`;
}

function auditClientScript(): string {
  return `
const vscode=acquireVsCodeApi();
const $=id=>document.getElementById(id);
let selectedIds=new Set();
let contentPaths=[];
let cpEnabled=false;

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

function init(){
  if(!STATE.projects.length){
    $('noproject').hidden=false;
    $('configSection').hidden=true;
    return;
  }
  STATE.projects.forEach(p=>selectedIds.add(p.id));
  renderProjects();
  setupListeners();
}

function renderProjects(){
  const el=$('projectList');
  $('projectCount').textContent=selectedIds.size+'/'+STATE.projects.length+' selected';
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
  const sa=$('selectActions');
  if(STATE.projects.length<2)sa.hidden=true;else sa.hidden=false;
}

function renderContentPaths(){
  const el=$('cpPaths');
  if(!contentPaths.length){el.innerHTML='<p class="muted">No folders selected.</p>';return;}
  el.innerHTML=contentPaths.map((p,i)=>
    '<div class="cp-path"><code>'+esc(p)+'</code><button type="button" class="remove" data-idx="'+i+'" aria-label="Remove '+esc(p.split('/').pop()||p)+'">\\u00d7</button></div>'
  ).join('');
  el.querySelectorAll('.remove').forEach(btn=>{
    btn.onclick=()=>{contentPaths.splice(parseInt(btn.dataset.idx),1);renderContentPaths();};
  });
}

function setupListeners(){
  const toggle=$('cpToggle');
  toggle.onclick=()=>{cpEnabled=!cpEnabled;toggle.className='toggle-switch'+(cpEnabled?' on':'');toggle.setAttribute('aria-checked',cpEnabled?'true':'false');$('cpConfig').hidden=!cpEnabled;};
  $('browsePkgs').onclick=()=>vscode.postMessage({type:'browsePackages'});
  const slider=$('threshold');
  slider.oninput=()=>{$('thresholdVal').textContent=slider.value+'%';slider.setAttribute('aria-valuetext',slider.value+'% similarity threshold');};
  $('selectAll').onclick=()=>{STATE.projects.forEach(p=>selectedIds.add(p.id));renderProjects();};
  $('deselectAll').onclick=()=>{selectedIds.clear();renderProjects();};
  $('runBtn').onclick=runAudit;
  $('exportBtn').onclick=()=>{$('exportStatus').hidden=true;vscode.postMessage({type:'exportExcel'});};
  $('rerunBtn').onclick=()=>{$('resultsSection').hidden=true;$('configSection').hidden=false;$('exportStatus').hidden=true;$('auditError').hidden=true;$('runBtn').focus();window.scrollTo(0,0);};
}

function runAudit(){
  if(!selectedIds.size){
    const err=$('auditError');err.hidden=false;err.textContent='Select at least one project to run the audit.';
    return;
  }
  $('auditError').hidden=true;
  $('runBtn').disabled=true;
  $('progressArea').hidden=false;
  $('progressFill').style.width='0%';
  $('progressFill').className='progress-fill indeterminate';
  $('progressText').textContent='Scanning projects and classifying components...';
  vscode.postMessage({
    type:'runAudit',
    projectIds:[...selectedIds],
    contentPaths:cpEnabled?contentPaths:[],
    duplicateThreshold:parseInt($('threshold').value)
  });
}

function renderResults(r){
  $('configSection').hidden=true;
  $('resultsSection').hidden=false;
  $('progressArea').hidden=true;
  $('runBtn').disabled=false;

  const s=r.summary;
  const projNames=r.projects.map(p=>p.artifactId).join(', ');
  $('resultsSub').textContent=projNames+' \\u00b7 '+s.totalComponents+' components \\u00b7 '+s.totalSites+' site(s)';

  // Metrics
  $('metricsGrid').innerHTML=[
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
  $('classChart').innerHTML=cls.map(c=>
    '<div class="class-bar '+c.cls+'" style="width:'+Math.max((c.count/total*100),c.count>0?3:0)+'%" title="'+c.label+': '+c.count+'"></div>'
  ).join('');
  $('classLegend').innerHTML=cls.map(c=>
    '<div class="legend-item"><div class="legend-dot '+c.cls+'"></div>'+c.label+': <strong>'+c.count+'</strong> ('+Math.round(c.count/total*100)+'%)</div>'
  ).join('');

  // Tech metrics
  $('techMetrics').innerHTML=[
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
    $('coreModelCard').hidden=false;
    $('coreModelContent').innerHTML='<div class="core-model-grid">'
      +'<div class="core-stat override"><strong>'+s.withCoreModelOverride+'</strong><span>Core Model Overrides</span></div>'
      +'<div class="core-stat ootb"><strong>'+s.coreProxiesWithoutModelOverride+'</strong><span>Using OOTB Model</span></div>'
      +'</div>'
      +'<p class="muted">Of '+coreTotal+' Core Component proxies, '+s.withCoreModelOverride+' have project-level Sling Model overrides.</p>';
  }else{$('coreModelCard').hidden=true;}

  // Site breakdown
  const sites=Object.entries(s.bySite).sort((a,b)=>b[1]-a[1]);
  if(sites.length>0){
    $('siteBreakdownCard').hidden=false;
    const maxSite=Math.max(...sites.map(e=>e[1]),1);
    $('siteBreakdownContent').innerHTML=sites.map(([site,count])=>{
      const pct=Math.round(count/maxSite*100);
      return '<div class="breakdown-row"><span class="breakdown-label">'+esc(site)+'</span><div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:'+pct+'%"></div></div><span class="breakdown-count">'+count+'</span></div>';
    }).join('');
  }else{$('siteBreakdownCard').hidden=true;}

  // Usage Coverage
  if(r.usageCoverage&&r.usageCoverage.length){
    $('usageCoverageCard').hidden=false;
    const hasPackages=s.contentPackagesAnalyzed>0;
    const missing=r.usageCoverage.filter(c=>!c.hasCoverage);
    const partial=r.usageCoverage.filter(c=>c.isPartial);
    let hint='Content package coverage across '+r.usageCoverage.length+' project(s).';
    if(!hasPackages)hint='No content packages provided. Provide CRX packages for production usage data.';
    else if(missing.length)hint+=(' '+missing.length+' project(s) missing content packages.');
    if(partial.length)hint+=(' '+partial.length+' project(s) with partial site coverage.');
    $('coverageHint').textContent=hint;

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
    $('usageCoverageContent').innerHTML=covHtml;
  }else{$('usageCoverageCard').hidden=true;}

  // Duplicates
  if(r.duplicates.length){
    $('duplicatesCard').hidden=false;
    $('duplicatesContent').innerHTML=r.duplicates.slice(0,20).map(d=>
      '<div class="dup-item">'
      +'<div><div class="dup-comp">'+esc(d.componentA)+'</div><div class="dup-site">'+esc(d.siteA)+'</div></div>'
      +'<div><div class="dup-comp">'+esc(d.componentB)+'</div><div class="dup-site">'+esc(d.siteB)+'</div></div>'
      +'<div class="dup-sim '+(d.similarity===100?'exact':'near')+'">'+d.similarity+'%</div>'
      +'</div>'
    ).join('')+(r.duplicates.length>20?'<p class="muted">...and '+(r.duplicates.length-20)+' more. Export to Excel for the full list.</p>':'');
  }else{$('duplicatesCard').hidden=true;}

  // Cross-site reuse
  if(r.crossSiteReuse.length){
    $('crossSiteCard').hidden=false;
    $('crossSiteContent').innerHTML=r.crossSiteReuse.slice(0,15).map(e=>
      '<div class="xsite-item">'
      +'<div><div class="xsite-name">'+esc(e.leafName)+'</div><div class="xsite-sites">'+esc(e.sites.join(', '))+'</div></div>'
      +'<span>'+e.sites.length+' sites</span>'
      +'<span class="xsite-badge '+(e.identical?'identical':'partial')+'">'+(e.identical?'Identical':''+e.similarity+'%')+'</span>'
      +'</div>'
    ).join('')+(r.crossSiteReuse.length>15?'<p class="muted">...and '+(r.crossSiteReuse.length-15)+' more. Export to Excel for the full list.</p>':'');
  }else{$('crossSiteCard').hidden=true;}

  // Recommendations
  if(r.recommendations.length){
    $('recsCard').hidden=false;
    $('recsContent').innerHTML=r.recommendations.map(rec=>
      '<div class="rec-item">'
      +'<div class="rec-head"><span class="rec-badge '+rec.impact+'">'+rec.impact+'</span><span class="rec-category">'+esc(rec.category)+'</span></div>'
      +'<div class="rec-finding">'+esc(rec.finding)+'</div>'
      +'<div class="rec-detail">'+esc(rec.recommendation)+'</div>'
      +(rec.affectedComponents.length?'<div class="rec-affected">Affected: '+rec.affectedComponents.slice(0,5).map(c=>'<code>'+esc(c)+'</code>').join(', ')+(rec.affectedComponents.length>5?' +\\u2009'+(rec.affectedComponents.length-5)+' more':'')+'</div>':'')
      +'</div>'
    ).join('');
  }else{$('recsCard').hidden=true;}

  // Top used
  if(r.topUsed.length){
    $('topUsedCard').hidden=false;
    $('topUsedContent').innerHTML='<table><thead><tr><th>Resource Type</th><th>Site</th><th>Usage</th></tr></thead><tbody>'
      +r.topUsed.map(c=>'<tr><td><code>'+esc(c.resourceType)+'</code></td><td>'+esc(c.site)+'</td><td><strong>'+c.usageCount+'</strong></td></tr>').join('')
      +'</tbody></table>';
  }else{$('topUsedCard').hidden=true;}

  // Unused
  if(r.topUnused.length){
    $('unusedCard').hidden=false;
    const classLabel={ootb:'OOTB',proxied:'Proxied','proxied-customized':'Proxied+Custom',custom:'Custom'};
    $('unusedContent').innerHTML='<table><thead><tr><th>Resource Type</th><th>Site</th><th>Classification</th></tr></thead><tbody>'
      +r.topUnused.map(c=>'<tr><td><code>'+esc(c.resourceType)+'</code></td><td>'+esc(c.site)+'</td><td>'+(classLabel[c.classification]||c.classification)+'</td></tr>').join('')
      +'</tbody></table>'
      +(s.unusedComponents>20?'<p class="muted" style="padding:8px 10px">Showing 20 of '+s.unusedComponents+'. Export for full list.</p>':'');
  }else{$('unusedCard').hidden=true;}

  $('generatedAt').textContent=r.generatedAt;
  window.scrollTo({top:0,behavior:'smooth'});
}

function metric(val,label,cls){
  return '<div class="metric'+(cls?' '+cls:'')+'"><strong>'+val+'</strong><span>'+label+'</span></div>';
}
function techRow(label,val){
  return '<div class="tech-row"><span class="tech-label">'+label+'</span><span class="tech-value">'+val+'</span></div>';
}

window.addEventListener('message',e=>{
  const m=e.data;if(!m)return;
  if(m.type==='packagesSelected'){
    const newPaths=(m.paths||[]).filter(p=>!contentPaths.includes(p));
    contentPaths.push(...newPaths);
    renderContentPaths();
  }
  if(m.type==='auditProgress'){
    $('progressArea').hidden=false;
    $('progressText').textContent=m.detail||'Processing...';
    if(m.step==='scanning'){$('progressFill').style.width='40%';$('progressFill').className='progress-fill';}
    if(m.step==='generating'){$('progressFill').style.width='80%';$('progressFill').className='progress-fill';}
  }
  if(m.type==='auditComplete'){
    $('progressFill').style.width='100%';
    $('progressFill').className='progress-fill';
    setTimeout(()=>{renderResults(m.result);$('resultsSection').focus();},300);
  }
  if(m.type==='auditError'){
    $('progressArea').hidden=true;
    $('runBtn').disabled=false;
    const err=$('auditError');err.hidden=false;err.textContent='Audit failed: '+m.error;
    err.focus();
  }
  if(m.type==='exportComplete'){
    const st=$('exportStatus');st.hidden=false;st.className='export-status ok';
    st.textContent='\\u2713 Report saved successfully \\u2014 '+m.path.split('/').pop();
  }
});

init();
`;
}

