/**
 * Unified Catalog panel — replaces the separate Dashboard, Configure & Generate,
 * and Tech Audit webview panels with a single tabbed panel (Overview / Configure /
 * Audit). One singleton panel instance; tabs never fully reload the document —
 * only Overview's data is pushed as an HTML-fragment refresh after any tab's
 * action completes, so in-progress Configure form edits and Audit results survive.
 */
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { buildOverviewTab, handleOverviewMessage, refreshOverviewHtml } from './catalogTabs/overviewTab';
import { buildConfigureTab, handleConfigureMessage } from './catalogTabs/configureTab';
import { buildAuditTab, handleAuditMessage } from './catalogTabs/auditTab';

let currentPanel: vscode.WebviewPanel | undefined;

export type CatalogTab = 'overview' | 'configure' | 'audit';

export interface OpenCatalogOptions {
  tab?: CatalogTab;
  projectRoot?: string;
}

export function openCatalogPanel(
  context: vscode.ExtensionContext,
  options?: OpenCatalogOptions,
  onRefresh?: () => void,
): void {
  const initialTab: CatalogTab = options?.tab ?? 'overview';

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    currentPanel.webview.postMessage({ tab: '_shell', type: 'activateTab', activeTab: initialTab });
    return;
  }

  const resources = vscode.Uri.joinPath(context.extensionUri, 'resources');
  const panel = vscode.window.createWebviewPanel(
    'aemCatalogPanel',
    'AEM Component Catalog',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  currentPanel = panel;
  panel.iconPath = vscode.Uri.joinPath(resources, 'icon.svg');
  panel.webview.html = render(initialTab, options?.projectRoot);

  panel.webview.onDidReceiveMessage(
    async (raw: unknown) => {
      const msg = raw as Record<string, unknown> | undefined;
      if (!msg || typeof msg.tab !== 'string') return;
      if (msg.tab === 'overview') await handleOverviewMessage(panel, msg, onRefresh);
      else if (msg.tab === 'configure') await handleConfigureMessage(panel, msg, onRefresh);
      else if (msg.tab === 'audit') await handleAuditMessage(panel, msg);
      else return;
      pushOverviewRefresh(panel);
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

function pushOverviewRefresh(panel: vscode.WebviewPanel): void {
  panel.webview.postMessage({ tab: 'overview', type: 'refreshHtml', bodyHtml: refreshOverviewHtml() });
}

function render(initialTab: CatalogTab, preselectRoot?: string): string {
  const nonce = crypto.randomBytes(18).toString('base64');
  const overview = buildOverviewTab();
  const configure = buildConfigureTab(preselectRoot);
  const audit = buildAuditTab(preselectRoot);

  const selected = (tab: CatalogTab): string => String(tab === initialTab);
  const hidden = (tab: CatalogTab): string => (tab === initialTab ? '' : 'hidden');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>AEM Component Catalog</title>
<style>${shellStyles()}
${overview.styles}
${configure.styles}
${audit.styles}
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div>
      <p class="eyebrow">AEM COMPONENT CATALOG</p>
      <h1>Component Catalog</h1>
      <p class="subtitle">Configure, generate, deploy, and audit your team's component showcase.</p>
    </div>
  </header>
  <div class="tabstrip" role="tablist" aria-label="Catalog sections">
    <button type="button" class="tabbtn" id="tabbtn-overview" role="tab" aria-selected="${selected('overview')}" aria-controls="tab-overview">Overview</button>
    <button type="button" class="tabbtn" id="tabbtn-configure" role="tab" aria-selected="${selected('configure')}" aria-controls="tab-configure">Configure</button>
    <button type="button" class="tabbtn" id="tabbtn-audit" role="tab" aria-selected="${selected('audit')}" aria-controls="tab-audit">Audit</button>
  </div>
  <section class="tab-panel" id="tab-overview" role="tabpanel" aria-labelledby="tabbtn-overview" tabindex="-1" ${hidden('overview')}>${overview.bodyHtml}</section>
  <section class="tab-panel" id="tab-configure" role="tabpanel" aria-labelledby="tabbtn-configure" tabindex="-1" ${hidden('configure')}>${configure.bodyHtml}</section>
  <section class="tab-panel" id="tab-audit" role="tabpanel" aria-labelledby="tabbtn-audit" tabindex="-1" ${hidden('audit')}>${audit.bodyHtml}</section>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
(function shell(){
  const tabs = ['overview', 'configure', 'audit'];
  function activate(name){
    tabs.forEach(function(t){
      document.getElementById('tab-' + t).hidden = (t !== name);
      document.getElementById('tabbtn-' + t).setAttribute('aria-selected', String(t === name));
    });
  }
  tabs.forEach(function(t){
    document.getElementById('tabbtn-' + t).onclick = function(){ activate(t); };
  });
  window.addEventListener('message', function(e){
    const m = e.data;
    if (m && m.tab === '_shell' && m.type === 'activateTab') activate(m.activeTab);
  });
})();
(function(vscode){
${overview.script}
})(vscode);
(function(vscode){
${configure.script}
})(vscode);
(function(vscode){
${audit.script}
})(vscode);
</script>
</body>
</html>`;
}

function shellStyles(): string {
  return `
:root{
  --panel:var(--vscode-sideBar-background);
  --fg:var(--vscode-editor-foreground);
  --muted:var(--vscode-descriptionForeground);
  --fg-muted:var(--vscode-descriptionForeground);
  --accent:var(--vscode-textLink-foreground);
  --card-bg:var(--vscode-editorWidget-background,var(--vscode-sideBar-background));
  --border:var(--vscode-panel-border,rgba(127,127,127,.18));
  --border-light:var(--vscode-widget-border,rgba(127,127,127,.1));
  --input-bg:var(--vscode-input-background);
  --btn-bg:var(--vscode-button-background);
  --btn-fg:var(--vscode-button-foreground);
  --btn-hover:var(--vscode-button-hoverBackground);
  --btn2-bg:var(--vscode-button-secondaryBackground);
  --btn2-fg:var(--vscode-button-secondaryForeground);
  --btn2-hover:var(--vscode-button-secondaryHoverBackground);
  --good:var(--vscode-testing-iconPassed,var(--vscode-charts-green,#42b883));
  --warn:var(--vscode-editorWarning-foreground,var(--vscode-charts-yellow,#d99b24));
  --bad:var(--vscode-editorError-foreground,var(--vscode-charts-red,#e45b64));
}
*{box-sizing:border-box}
body{margin:0;padding:28px;font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font-size:13px}
.wrap{max-width:960px;margin:0 auto}
.hero{padding-bottom:18px;border-bottom:1px solid var(--vscode-panel-border);margin-bottom:20px}
.eyebrow{margin:0 0 6px;color:var(--vscode-textLink-foreground);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0 0 6px;font-size:24px}
.subtitle{color:var(--vscode-descriptionForeground);margin:0;font-size:13px;line-height:1.5}
.tabstrip{display:flex;gap:4px;border-bottom:1px solid var(--vscode-panel-border);margin-bottom:22px}
.tabbtn{padding:9px 16px;border:none;background:none;color:var(--vscode-descriptionForeground);font:inherit;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabbtn:hover{color:var(--vscode-foreground)}
.tabbtn[aria-selected="true"]{color:var(--vscode-foreground);border-bottom-color:var(--vscode-textLink-foreground)}
.tabbtn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
.tab-panel:focus-visible{outline:none}
@media(max-width:900px){body{padding:18px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
}
