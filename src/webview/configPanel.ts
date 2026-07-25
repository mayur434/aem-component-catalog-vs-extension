/**
 * Visual "Configure & Generate" panel.
 *
 * Replaces hand-editing .component-library.json: the user picks a brand color,
 * a title, and toggles features, then clicks Generate. The panel writes the
 * configuration and generates the micro-site directly — no Doctor, no preflight,
 * no gate of any kind.
 */
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { configExists, loadConfig, saveConfig } from '../config/loader';
import { getDefaults } from '../config/defaults';
import type { ComponentLibraryConfig } from '../config/schema';
import { runGeneration } from '../commands/generate';
import { discoverWorkspaceProjects } from '../commands/projectSelection';
import type { ProjectInfo } from '../scanner/projectDetector';

let panel: vscode.WebviewPanel | undefined;

const TITLE_PRESETS = ['Component Catalog', 'Design System', 'Component Library', 'UI Library', 'Pattern Library'];
const PRIMARY_SWATCHES = ['#03438E', '#0A66C2', '#005289', '#1D6B3F', '#7A1F2B', '#452B6D', '#00767B', '#1E1E1E'];
const ACCENT_SWATCHES = ['#4CADE9', '#00ABE8', '#FFD700', '#4CAF50', '#FF7043', '#9C27B0', '#26C6DA', '#F4A62A'];
const SUBCATEGORY_OPTIONS = ['catalogSubCategory', 'componentGroup', 'cq:styleGroups'];
const FEATURES: Array<{ key: keyof ComponentLibraryConfig['features']; label: string; hint: string }> = [
  { key: 'search', label: 'Search bar', hint: 'Full-text search across components' },
  { key: 'groupFilters', label: 'Category filters', hint: 'Filter pills by website/category' },
  { key: 'lightbox', label: 'Screenshot lightbox', hint: 'Zoomable layout previews' },
  { key: 'codeSnippets', label: 'Code snippets', hint: 'Copy-ready HTL usage' },
  { key: 'readme', label: 'README docs', hint: 'Render component READMEs' },
  { key: 'qualityScore', label: 'Quality metrics', hint: 'Quality strip + per-card score' },
  { key: 'dependencyGraph', label: 'Relationships', hint: 'Super-type siblings on detail pages' },
  { key: 'accessibility', label: 'Accessibility notes', hint: 'A11y guidance section' },
  { key: 'darkMode', label: 'Dark mode', hint: 'Dark theme toggle in the site' },
];
const HEX = /^#[0-9a-fA-F]{6}$/;
const JCR_PROPERTY = /^[a-zA-Z_][a-zA-Z0-9:_-]*$/;

interface PanelProject {
  id: string;
  artifactId: string;
  root: string;
  javaPackage: string;
  selections: Selections;
}

interface Selections {
  primary: string;
  accent: string;
  title: string;
  subCategoryProperty: string;
  features: Record<string, boolean>;
}

export function openConfigPanel(context: vscode.ExtensionContext, onDone?: () => void): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    return;
  }
  panel = vscode.window.createWebviewPanel(
    'aemMicrositeConfigurator',
    'Component Catalog — Configure & Generate',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const active = panel;
  active.webview.html = render();

  active.webview.onDidReceiveMessage(
    async (raw: unknown) => {
      const message = raw as Record<string, unknown>;
      if (!message || message.type !== 'generate') return;
      await handleGenerate(active, message, onDone);
    },
    undefined,
    context.subscriptions,
  );
  active.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
}

async function handleGenerate(
  active: vscode.WebviewPanel,
  message: Record<string, unknown>,
  onDone?: () => void,
): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    active.webview.postMessage({ type: 'result', ok: false, error: 'Trust this workspace to generate files.' });
    return;
  }
  const projects = buildProjects();
  const project = projects.find((candidate) => candidate.id === message.projectId);
  if (!project) {
    active.webview.postMessage({ type: 'result', ok: false, error: 'That project is no longer in the workspace.' });
    return;
  }
  try {
    const config = applySelections(project, message);
    saveConfig(project.root, config);
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Generating component micro-site' },
      () => Promise.resolve(runGeneration(project.root)),
    );
    active.webview.postMessage({
      type: 'result',
      ok: true,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      authorPath: `${config.output.contentPath}.html`,
    });
    onDone?.();
  } catch (error) {
    active.webview.postMessage({
      type: 'result',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Merge validated, whitelisted selections into fresh defaults. */
function applySelections(project: PanelProject, message: Record<string, unknown>): ComponentLibraryConfig {
  const config = getDefaults(project.artifactId);
  config.output.servletPackage = project.javaPackage;
  config.hero.badge = project.artifactId;
  config.hero.titlePrefix = project.artifactId;

  const primary = String(message.primary ?? '');
  const accent = String(message.accent ?? '');
  if (HEX.test(primary)) config.brand.primary = primary;
  if (HEX.test(accent)) config.brand.accent = accent;

  const title = String(message.title ?? '').trim();
  if (title && title.length <= 60 && !/[<>{}]/.test(title)) {
    config.output.pageTitle = title;
    config.hero.titleHighlight = title;
  }

  const property = String(message.subCategoryProperty ?? '');
  if (JCR_PROPERTY.test(property)) config.taxonomy.subCategoryProperty = property;

  const features = (message.features ?? {}) as Record<string, unknown>;
  for (const { key } of FEATURES) {
    config.features[key] = features[key] === true;
  }
  return config;
}

function buildProjects(): PanelProject[] {
  return discoverWorkspaceProjects().map((info) => ({
    id: projectId(info.root),
    artifactId: info.artifactId,
    root: info.root,
    javaPackage: info.javaPackage,
    selections: currentSelections(info),
  }));
}

function currentSelections(info: ProjectInfo): Selections {
  let config: ComponentLibraryConfig;
  try {
    config = configExists(info.root) ? loadConfig(info.root) : getDefaults(info.artifactId);
  } catch {
    config = getDefaults(info.artifactId);
  }
  const features: Record<string, boolean> = {};
  for (const { key } of FEATURES) features[key] = Boolean(config.features[key]);
  return {
    primary: config.brand.primary,
    accent: config.brand.accent,
    title: config.output.pageTitle,
    subCategoryProperty: config.taxonomy.subCategoryProperty,
    features,
  };
}

function render(): string {
  const nonce = crypto.randomBytes(18).toString('base64');
  const state = {
    projects: buildProjects(),
    titlePresets: TITLE_PRESETS,
    primarySwatches: PRIMARY_SWATCHES,
    accentSwatches: ACCENT_SWATCHES,
    subCategoryOptions: SUBCATEGORY_OPTIONS,
    features: FEATURES,
  };
  const stateJson = JSON.stringify(state).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Configure &amp; Generate</title>
<style>${styles()}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Component Catalog</h1>
    <p class="sub">Pick your options and generate the micro-site. No files to hand-edit.</p>
  </header>

  <section class="card" id="noproject" hidden>
    <p>No AEM as a Cloud Service project was found in this workspace.</p>
  </section>

  <div id="form" hidden>
    <section class="card">
      <label class="field-label" for="project">Project</label>
      <select id="project"></select>
    </section>

    <section class="card">
      <h2>Primary color</h2>
      <div class="swatches" id="primary"></div>
    </section>

    <section class="card">
      <h2>Accent color</h2>
      <div class="swatches" id="accent"></div>
    </section>

    <section class="card">
      <h2>Catalog title</h2>
      <div class="pills" id="title"></div>
    </section>

    <section class="card">
      <h2>Sub-category source</h2>
      <div class="pills" id="subcat"></div>
    </section>

    <section class="card">
      <h2>Features</h2>
      <div class="toggles" id="features"></div>
    </section>

    <div class="footer">
      <div id="status" class="status"></div>
      <button id="generate" class="primary">Generate Micro-site</button>
    </div>
  </div>
</div>
<script nonce="${nonce}">const STATE=${stateJson};${clientScript()}</script>
</body>
</html>`;
}

function styles(): string {
  return `
*{box-sizing:border-box}
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:0;font-size:13px}
.wrap{max-width:760px;margin:0 auto;padding:28px 24px 60px}
header h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--vscode-descriptionForeground);margin:0 0 20px}
.card{background:var(--vscode-editorWidget-background,rgba(127,127,127,.08));border:1px solid var(--vscode-widget-border,rgba(127,127,127,.25));border-radius:10px;padding:16px 18px;margin-bottom:14px}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-descriptionForeground);margin:0 0 12px}
.field-label{display:block;font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:6px}
select{width:100%;padding:8px 10px;border-radius:6px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border,transparent);font:inherit}
.swatches{display:flex;flex-wrap:wrap;gap:10px}
.swatch{width:38px;height:38px;border-radius:9px;border:2px solid transparent;cursor:pointer;position:relative;outline:1px solid rgba(127,127,127,.3)}
.swatch.sel{border-color:var(--vscode-focusBorder,#4CADE9);box-shadow:0 0 0 2px var(--vscode-focusBorder,#4CADE9)}
.swatch.sel::after{content:"";position:absolute;inset:0;margin:auto;width:12px;height:7px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:rotate(-45deg) translate(1px,-2px);mix-blend-mode:difference}
.pills{display:flex;flex-wrap:wrap;gap:8px}
.pill{padding:7px 14px;border-radius:20px;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.35));background:transparent;color:var(--vscode-foreground);cursor:pointer;font:inherit}
.pill.sel{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:var(--vscode-button-background)}
.toggles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.toggle{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.25));border-radius:8px;cursor:pointer}
.toggle .track{flex:none;width:34px;height:20px;border-radius:20px;background:rgba(127,127,127,.4);position:relative;transition:.15s}
.toggle .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
.toggle.on .track{background:var(--vscode-button-background)}
.toggle.on .track::after{transform:translateX(14px)}
.toggle .meta{display:flex;flex-direction:column;gap:1px}
.toggle .meta b{font-weight:600}
.toggle .meta small{color:var(--vscode-descriptionForeground)}
.footer{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0 0;margin-top:6px}
.status{font-size:12px;color:var(--vscode-descriptionForeground)}
.status.ok{color:var(--vscode-testing-iconPassed,#4CAF50)}
.status.err{color:var(--vscode-errorForeground,#f14c4c)}
button.primary{padding:11px 22px;border:none;border-radius:8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font:inherit;font-weight:600;cursor:pointer}
button.primary:hover{background:var(--vscode-button-hoverBackground)}
button.primary:disabled{opacity:.5;cursor:default}
@media(max-width:560px){.toggles{grid-template-columns:1fr}}
`;
}

function clientScript(): string {
  return `
const vscode=acquireVsCodeApi();
const $=(id)=>document.getElementById(id);
let cur=null;
function selectProject(id){cur=STATE.projects.find(p=>p.id===id);renderForm();}
function renderSwatches(elId,list,key){const el=$(elId);el.innerHTML='';list.forEach(c=>{const s=document.createElement('div');s.className='swatch'+(cur.selections[key].toLowerCase()===c.toLowerCase()?' sel':'');s.style.background=c;s.title=c;s.onclick=()=>{cur.selections[key]=c;renderSwatches(elId,list,key);};el.appendChild(s);});
  if(!list.some(c=>c.toLowerCase()===cur.selections[key].toLowerCase())){const s=document.createElement('div');s.className='swatch sel';s.style.background=cur.selections[key];s.title=cur.selections[key];el.appendChild(s);} }
function renderPills(elId,list,key){const el=$(elId);el.innerHTML='';const opts=list.includes(cur.selections[key])?list:[cur.selections[key],...list];opts.forEach(v=>{const b=document.createElement('button');b.className='pill'+(cur.selections[key]===v?' sel':'');b.textContent=v;b.onclick=()=>{cur.selections[key]=v;renderPills(elId,list,key);};el.appendChild(b);});}
function renderFeatures(){const el=$('features');el.innerHTML='';STATE.features.forEach(f=>{const on=!!cur.selections.features[f.key];const d=document.createElement('div');d.className='toggle'+(on?' on':'');d.innerHTML='<span class="track"></span><span class="meta"><b>'+f.label+'</b><small>'+f.hint+'</small></span>';d.onclick=()=>{cur.selections.features[f.key]=!cur.selections.features[f.key];renderFeatures();};el.appendChild(d);});}
function renderForm(){renderSwatches('primary',STATE.primarySwatches,'primary');renderSwatches('accent',STATE.accentSwatches,'accent');renderPills('title',STATE.titlePresets,'title');renderPills('subcat',STATE.subCategoryOptions,'subCategoryProperty');renderFeatures();}
function init(){
  if(!STATE.projects.length){$('noproject').hidden=false;return;}
  $('form').hidden=false;
  const sel=$('project');STATE.projects.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.artifactId;sel.appendChild(o);});
  sel.onchange=()=>selectProject(sel.value);
  if(STATE.projects.length<2){sel.parentElement.hidden=true;}
  selectProject(STATE.projects[0].id);
  $('generate').onclick=()=>{
    const st=$('status');st.className='status';st.textContent='Generating…';$('generate').disabled=true;
    vscode.postMessage({type:'generate',projectId:cur.id,primary:cur.selections.primary,accent:cur.selections.accent,title:cur.selections.title,subCategoryProperty:cur.selections.subCategoryProperty,features:cur.selections.features});
  };
}
window.addEventListener('message',e=>{const m=e.data;if(m&&m.type==='result'){$('generate').disabled=false;const st=$('status');if(m.ok){st.className='status ok';st.textContent='Done · '+m.created+' created · '+m.updated+' updated. Deploy, then open '+m.authorPath;}else{st.className='status err';st.textContent=m.error;}}});
init();
`;
}

function projectId(root: string): string {
  return crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
}
