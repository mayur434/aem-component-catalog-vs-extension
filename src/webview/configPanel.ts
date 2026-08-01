/**
 * Visual "Configure & Generate" panel.
 *
 * Replaces hand-editing .component-library.json. The user sets a title, picks or
 * enters brand colors (with optional auto-detection from the workspace clientlib
 * CSS), chooses the sub-category fallback property, and toggles features — then
 * clicks Generate. It writes the configuration and generates the micro-site
 * directly: no Doctor, no preflight, no gate of any kind.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { projectId } from '../utils/webviewHelpers';
import { saveConfig } from '../config/loader';
import { runGeneration } from '../commands/generate';
import { deployLocal } from '../commands/deploy';
import { discoverWorkspaceProjects } from '../commands/projectSelection';
import {
  applySelections,
  currentSelections,
  ACCENT_SWATCHES,
  BACKGROUND_SWATCHES,
  FEATURES,
  PRIMARY_SWATCHES,
  TITLE_PRESETS,
  type Selections,
} from './panelSelections';

let panel: vscode.WebviewPanel | undefined;

interface PanelProject {
  id: string;
  artifactId: string;
  root: string;
  javaPackage: string;
  selections: Selections;
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
      if (!message) return;
      if (message.type === 'generate') await handleGenerate(active, message, onDone);
      else if (message.type === 'detectTheme') handleDetect(active, message);
      else if (message.type === 'deploy') await handleDeploy(active, message);
    },
    undefined,
    context.subscriptions,
  );
  active.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
}

function handleDetect(active: vscode.WebviewPanel, message: Record<string, unknown>): void {
  const project = buildProjects().find((candidate) => candidate.id === message.projectId);
  const colors = project ? detectThemeColors(project.root) : [];
  active.webview.postMessage({ type: 'detected', colors });
}

async function handleDeploy(active: vscode.WebviewPanel, message: Record<string, unknown>): Promise<void> {
  const project = buildProjects().find((candidate) => candidate.id === message.projectId);
  if (!project) {
    active.webview.postMessage({ type: 'deployStarted', ok: false });
    return;
  }
  active.webview.postMessage({ type: 'deployStarted', ok: true });
  await deployLocal(project.root); // confirm modal + start/finish toasts live here
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
  const project = buildProjects().find((candidate) => candidate.id === message.projectId);
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
    vscode.window.showInformationMessage(
      `✓ Micro-site generated · ${result.created} created · ${result.updated} updated · ${result.skipped} preserved.`,
    );
    onDone?.();
  } catch (error) {
    active.webview.postMessage({
      type: 'result',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ---------------------------------------------------- theme auto-detection */

/** Scan the project's clientlib CSS for brand-like colors, most relevant first. */
function detectThemeColors(projectRoot: string): string[] {
  const root = path.join(projectRoot, 'ui.apps', 'src', 'main', 'content', 'jcr_root');
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  collectCss(root, files, 0);
  const score = new Map<string, number>();
  let budget = 400;
  for (const file of files) {
    if (budget-- <= 0) break;
    let css: string;
    try {
      css = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    // Colors defined on brand-ish CSS variables are the strongest signal.
    for (const match of css.matchAll(
      /--[a-z0-9-]*(?:primary|brand|accent|theme|secondary|highlight)[a-z0-9-]*\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
    )) {
      bump(score, match[1], 6);
    }
    for (const match of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      bump(score, `#${match[1]}`, 1);
    }
  }
  return [...score.entries()]
    .map(([color, weight]) => ({ color: normalizeHex(color), weight }))
    .filter((entry) => entry.color !== '' && isBrandColor(entry.color))
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => entry.color)
    .filter((color, index, all) => all.indexOf(color) === index)
    .slice(0, 8);
}

function collectCss(directory: string, out: string[], depth: number): void {
  if (depth > 12 || out.length > 800) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'clientlib-componentlibrary') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collectCss(full, out, depth + 1);
    else if (/\.(css|less|scss)$/i.test(entry.name)) out.push(full);
  }
}

function bump(map: Map<string, number>, color: string, weight: number): void {
  map.set(color, (map.get(color) ?? 0) + weight);
}

function normalizeHex(hex: string): string {
  let value = hex.replace('#', '').toLowerCase();
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  if (value.length === 8) value = value.slice(0, 6);
  return /^[0-9a-f]{6}$/.test(value) ? `#${value}` : '';
}

/** Keep saturated, mid-lightness colors; drop near-white, near-black, and greys. */
function isBrandColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation > 0.18 && lightness > 0.12 && lightness < 0.9;
}

/* ----------------------------------------------------------------- state */

function buildProjects(): PanelProject[] {
  return discoverWorkspaceProjects().map((info) => ({
    id: projectId(info.root),
    artifactId: info.artifactId,
    root: info.root,
    javaPackage: info.javaPackage,
    selections: currentSelections(info),
  }));
}

function render(): string {
  const nonce = crypto.randomBytes(18).toString('base64');
  const state = {
    projects: buildProjects(),
    titlePresets: TITLE_PRESETS,
    primarySwatches: PRIMARY_SWATCHES,
    accentSwatches: ACCENT_SWATCHES,
    backgroundSwatches: BACKGROUND_SWATCHES,
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
    <p class="eyebrow">AEM COMPONENT CATALOG</p>
    <h1>Configure &amp; Generate</h1>
    <p class="sub">Pick your options below — no JSON to hand-edit. Generating never blocks on Cloud Doctor or governance checks.</p>
  </header>

  <section class="card" id="noproject" hidden><p>No AEM as a Cloud Service project was found in this workspace.</p></section>

  <div id="form" hidden>
    <section class="card" id="projectcard">
      <label class="field-label" for="project">Project</label>
      <select id="project"></select>
    </section>

    <section class="card">
      <label class="field-label" for="brandInput">Brand name</label>
      <input id="brandInput" type="text" maxlength="40" placeholder="Pidilite"/>
      <p class="muted">Shown as the hero prefix — e.g. “<b>Pidilite</b> Component Catalog”.</p>
      <label class="field-label spaced" for="titleInput">Catalog title</label>
      <input id="titleInput" type="text" maxlength="80" placeholder="Component Catalog"/>
      <div class="pills small" id="titlePresets"></div>
      <label class="field-label spaced" for="descInput">Description <span class="muted">(optional)</span></label>
      <input id="descInput" type="text" maxlength="240" placeholder="Auto-filled from the brand name…"/>
    </section>

    <section class="card">
      <div class="row-head">
        <h2>Theme</h2>
        <button type="button" class="ghost" id="detect">Detect from workspace</button>
      </div>
      <p class="muted" id="detecthint" hidden></p>
      <label class="field-label">Primary</label>
      <div class="swatches" id="primary"></div>
      <label class="field-label spaced">Accent</label>
      <div class="swatches" id="accent"></div>
      <label class="field-label spaced">Background</label>
      <div class="swatches" id="background"></div>
      <label class="field-label spaced">Preview</label>
      <div class="preview" id="preview">
        <div class="preview-hero">
          <span class="preview-badge" id="previewBadge">Pidilite</span>
          <strong id="previewTitle">Component Catalog</strong>
          <span class="preview-btn" id="previewBtn">Browse components</span>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Sub-category (fallback)</h2>
      <label class="field-label" for="subcatInput">Use this property when a component defines it…</label>
      <input id="subcatInput" type="text" maxlength="60" placeholder="catalogSubCategory"/>
      <p class="muted">…otherwise it falls back automatically to the component's <code>componentGroup</code>.</p>
    </section>

    <section class="card">
      <h2>Features</h2>
      <div class="toggles" id="features"></div>
      <div class="governance">
        <label class="field-label spaced">Governance <span class="muted">(optional)</span></label>
        <div class="toggles" id="governanceFeatures"></div>
      </div>
    </section>

    <div class="footer">
      <div id="status" class="status"></div>
      <div class="footer-actions">
        <button id="deploy" class="ghost">Deploy to Local AEM</button>
        <button id="generate" class="primary">Generate Micro-site</button>
      </div>
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
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;font-size:13px}
.wrap{max-width:760px;margin:0 auto;padding:26px 24px 70px}
.eyebrow{margin:0 0 4px;color:var(--vscode-textLink-foreground,#4CADE9);font-size:10px;font-weight:700;letter-spacing:.14em}
header h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--vscode-descriptionForeground);margin:0 0 20px}
.card{background:var(--vscode-editorWidget-background,rgba(127,127,127,.08));border:1px solid var(--vscode-widget-border,rgba(127,127,127,.25));border-radius:10px;padding:16px 18px;margin-bottom:14px}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-descriptionForeground);margin:0 0 12px}
.row-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.row-head h2{margin:0}
.field-label{display:block;font-size:12px;color:var(--vscode-descriptionForeground);margin:0 0 6px}
.field-label.spaced{margin-top:14px}
.muted{color:var(--vscode-descriptionForeground);font-size:12px;margin:8px 0 0}
input[type=text]{width:100%;padding:9px 11px;border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);font:inherit}
input[type=text]:focus{outline:none;border-color:var(--vscode-focusBorder)}
select{width:100%;padding:8px 10px;border-radius:6px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border,transparent);font:inherit}
.swatches{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.swatch{width:36px;height:36px;border-radius:9px;border:2px solid transparent;cursor:pointer;position:relative;outline:1px solid rgba(127,127,127,.3);padding:0}
.swatch:focus-visible{outline:2px solid var(--vscode-focusBorder,#4CADE9);outline-offset:2px}
.swatch.detected{outline:1px dashed var(--vscode-focusBorder,#4CADE9)}
.swatch.sel{border-color:var(--vscode-focusBorder,#4CADE9);box-shadow:0 0 0 2px var(--vscode-focusBorder,#4CADE9)}
.swatch.sel::after{content:"";position:absolute;inset:0;margin:auto;width:11px;height:6px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:rotate(-45deg) translate(1px,-2px);mix-blend-mode:difference}
.picker{width:36px;height:36px;padding:0;border:none;border-radius:9px;overflow:hidden;cursor:pointer;background:none;outline:1px dashed rgba(127,127,127,.5)}
.picker::-webkit-color-swatch-wrapper{padding:0}
.picker::-webkit-color-swatch{border:none;border-radius:9px}
.preview{border-radius:8px;overflow:hidden;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.3))}
.preview-hero{display:flex;align-items:center;gap:12px;padding:18px 16px;transition:background-color .15s}
.preview-badge{padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.04em;background:rgba(255,255,255,.22);color:inherit}
.preview-hero strong{flex:1;font-size:15px}
.preview-btn{padding:6px 12px;border-radius:6px;font-size:11px;font-weight:600;background:rgba(255,255,255,.9);color:#111}
.pills{display:flex;flex-wrap:wrap;gap:8px}
.pills.small{margin-top:10px}
.pill{padding:6px 12px;border-radius:20px;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.35));background:transparent;color:var(--vscode-foreground);cursor:pointer;font:inherit;font-size:12px}
.pill:hover{border-color:var(--vscode-focusBorder)}
.toggles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.toggle{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.25));border-radius:8px;cursor:pointer;background:none;font:inherit;color:inherit;width:100%;text-align:left}
.toggle:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
.toggle .track{flex:none;width:34px;height:20px;border-radius:20px;background:rgba(127,127,127,.4);position:relative;transition:.15s}
.toggle .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
.toggle.on .track{background:var(--vscode-button-background)}
.toggle.on .track::after{transform:translateX(14px)}
.toggle .meta{display:flex;flex-direction:column;gap:1px}
.toggle .meta b{font-weight:600}
.toggle .meta small{color:var(--vscode-descriptionForeground)}
.governance{margin-top:16px;padding-top:14px;border-top:1px dashed var(--vscode-widget-border,rgba(127,127,127,.3))}
.governance .toggle{opacity:.85}
.ghost{padding:6px 12px;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.4));border-radius:6px;background:transparent;color:var(--vscode-foreground);cursor:pointer;font:inherit;font-size:12px}
.ghost:hover{border-color:var(--vscode-focusBorder)}
.footer{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0 0;background:var(--vscode-editor-background);border-top:1px solid var(--vscode-widget-border,rgba(127,127,127,.2));margin-top:8px}
.footer-actions{display:flex;gap:10px;align-items:center}
.status{font-size:12px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:10px}
.status.ok{color:var(--vscode-testing-iconPassed,#4CAF50)}
.status.err{color:var(--vscode-errorForeground,#f14c4c)}
.status .link{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:underline;background:none;border:none;font:inherit;padding:0}
code{background:rgba(127,127,127,.18);padding:1px 5px;border-radius:4px;font-family:var(--vscode-editor-font-family,monospace)}
button.primary{padding:11px 22px;border:none;border-radius:8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font:inherit;font-weight:600;cursor:pointer}
button.primary:hover{background:var(--vscode-button-hoverBackground)}
button.primary:disabled{opacity:.5;cursor:default}
@media(max-width:560px){.toggles{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
}

function clientScript(): string {
  return `
const vscode=acquireVsCodeApi();
const $=(id)=>document.getElementById(id);
let cur=null,detected=[];
function eq(a,b){return String(a).toLowerCase()===String(b).toLowerCase();}
function luminance(hex){const n=hex.replace('#','');if(!/^[0-9a-f]{6}$/i.test(n))return 0;const c=[0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
function selectProject(id){cur=STATE.projects.find(p=>p.id===id);detected=[];$('detecthint').hidden=true;renderAll();}
function swatchRow(elId,list,key){
  const el=$(elId);el.innerHTML='';
  const combined=list.slice();
  detected.forEach(c=>{if(!combined.some(x=>eq(x,c)))combined.push(c);});
  combined.forEach(c=>{
    const s=document.createElement('button');s.type='button';
    s.className='swatch'+(detected.some(d=>eq(d,c))?' detected':'')+(eq(cur.selections[key],c)?' sel':'');
    s.style.background=c;s.title=c;s.setAttribute('aria-label',key+' color '+c+(eq(cur.selections[key],c)?' (selected)':''));s.onclick=()=>{cur.selections[key]=c;swatchRow(elId,list,key);renderPreview();};el.appendChild(s);
  });
  const pick=document.createElement('input');pick.type='color';pick.className='picker';
  pick.value=/^#[0-9a-f]{6}$/i.test(cur.selections[key])?cur.selections[key]:'#000000';pick.title='Custom '+key+' color';pick.setAttribute('aria-label','Custom '+key+' color picker');
  pick.oninput=()=>{cur.selections[key]=pick.value;swatchRow(elId,list,key);renderPreview();};el.appendChild(pick);
}
function renderPresets(elId,list,cb){const el=$(elId);el.innerHTML='';list.forEach(v=>{const b=document.createElement('button');b.type='button';b.className='pill';b.textContent=v;b.onclick=()=>cb(v);el.appendChild(b);});}
function renderFeatureGroup(elId,group){const el=$(elId);el.innerHTML='';STATE.features.filter(f=>f.group===group).forEach(f=>{const on=!!cur.selections.features[f.key];const d=document.createElement('button');d.type='button';d.className='toggle'+(on?' on':'');d.setAttribute('role','switch');d.setAttribute('aria-checked',on?'true':'false');d.setAttribute('aria-label',f.label+': '+f.hint);d.innerHTML='<span class="track" aria-hidden="true"></span><span class="meta"><b>'+f.label+'</b><small>'+f.hint+'</small></span>';d.onclick=()=>{cur.selections.features[f.key]=!cur.selections.features[f.key];renderFeatureGroup(elId,group);};el.appendChild(d);});}
function renderPreview(){
  const p=cur.selections;
  $('preview').querySelector('.preview-hero').style.background=/^#[0-9a-f]{6}$/i.test(p.primary)?p.primary:'#03438E';
  const dark=luminance(p.primary)>0.5;
  $('preview').querySelector('.preview-hero').style.color=dark?'#111':'#fff';
  $('previewBadge').textContent=p.brandName||'Brand';
  $('previewBadge').style.background=dark?'rgba(0,0,0,.12)':'rgba(255,255,255,.22)';
  $('previewTitle').textContent=p.title||'Component Catalog';
  $('previewBtn').style.background=/^#[0-9a-f]{6}$/i.test(p.accent)?p.accent:'#4CADE9';
  $('previewBtn').style.color=luminance(p.accent)>0.5?'#111':'#fff';
}
function renderAll(){
  $('brandInput').value=cur.selections.brandName;
  $('titleInput').value=cur.selections.title;
  $('descInput').value=cur.selections.description;
  $('subcatInput').value=cur.selections.subCategoryProperty;
  swatchRow('primary',STATE.primarySwatches,'primary');
  swatchRow('accent',STATE.accentSwatches,'accent');
  swatchRow('background',STATE.backgroundSwatches,'background');
  renderFeatureGroup('features','core');
  renderFeatureGroup('governanceFeatures','governance');
  renderPreview();
}
function init(){
  if(!STATE.projects.length){$('noproject').hidden=false;return;}
  $('form').hidden=false;
  const sel=$('project');STATE.projects.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.artifactId;sel.appendChild(o);});
  sel.onchange=()=>selectProject(sel.value);
  if(STATE.projects.length<2)$('projectcard').hidden=true;
  renderPresets('titlePresets',STATE.titlePresets,v=>{cur.selections.title=v;$('titleInput').value=v;renderPreview();});
  $('brandInput').oninput=()=>{cur.selections.brandName=$('brandInput').value;renderPreview();};
  $('titleInput').oninput=()=>{cur.selections.title=$('titleInput').value;renderPreview();};
  $('descInput').oninput=()=>{cur.selections.description=$('descInput').value;};
  $('subcatInput').oninput=()=>{cur.selections.subCategoryProperty=$('subcatInput').value;};
  $('detect').onclick=()=>{$('detect').disabled=true;$('detect').textContent='Scanning…';vscode.postMessage({type:'detectTheme',projectId:cur.id});};
  selectProject(STATE.projects[0].id);
  $('generate').onclick=()=>{
    const st=$('status');st.className='status';st.textContent='Generating…';$('generate').disabled=true;
    vscode.postMessage({type:'generate',projectId:cur.id,primary:cur.selections.primary,accent:cur.selections.accent,background:cur.selections.background,brandName:cur.selections.brandName,title:cur.selections.title,description:cur.selections.description,subCategoryProperty:cur.selections.subCategoryProperty,features:cur.selections.features});
  };
  $('deploy').onclick=()=>{vscode.postMessage({type:'deploy',projectId:cur.id});};
}
window.addEventListener('message',e=>{const m=e.data;if(!m)return;
  if(m.type==='detected'){$('detect').disabled=false;$('detect').textContent='Detect from workspace';detected=Array.isArray(m.colors)?m.colors:[];
    const h=$('detecthint');h.hidden=false;h.textContent=detected.length?('Found '+detected.length+' brand color(s) in your clientlib CSS — shown with a dashed outline.'):'No brand colors detected in the workspace clientlib CSS.';
    swatchRow('primary',STATE.primarySwatches,'primary');swatchRow('accent',STATE.accentSwatches,'accent');swatchRow('background',STATE.backgroundSwatches,'background');renderPreview();}
  if(m.type==='deployStarted'){const st=$('status');st.className='status';st.textContent=m.ok?'Deploy started — confirm the prompt; watch the terminal + toast.':'Could not start deploy.';}
  if(m.type==='result'){
    $('generate').disabled=false;const st=$('status');st.innerHTML='';
    if(m.ok){
      st.className='status ok';
      const summary=document.createElement('span');summary.textContent='✓ Generated · '+m.created+' created · '+m.updated+' updated. Next: deploy, then open ';
      const path=document.createElement('code');path.textContent=m.authorPath;
      st.appendChild(summary);st.appendChild(path);
    }else{
      st.className='status err';st.textContent=m.error;
    }
  }
});
init();
`;
}

