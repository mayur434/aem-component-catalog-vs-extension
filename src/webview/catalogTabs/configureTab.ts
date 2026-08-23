/**
 * Configure tab — visual "Configure & Generate" panel.
 *
 * Replaces hand-editing .component-library.json. The user sets a title, picks or
 * enters brand colors (with optional auto-detection from the workspace clientlib
 * CSS), chooses the sub-category fallback property, and toggles features — then
 * clicks Generate. It writes the configuration and generates the micro-site
 * directly: no Doctor, no preflight, no gate of any kind.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { TabRenderResult } from './types';
import { projectId } from '../../utils/webviewHelpers';
import { saveConfig } from '../../config/loader';
import { checkGenerationPrerequisites } from '../../core/preflight';
import { runGeneration } from '../../commands/generate';
import { deployLocal } from '../../commands/deploy';
import { discoverWorkspaceProjects } from '../../commands/projectSelection';
import { getAemAdapter } from '../../scanner/platformAdapter';
import {
  applySelections,
  currentSelections,
  ACCENT_SWATCHES,
  BACKGROUND_SWATCHES,
  FEATURES,
  PRIMARY_SWATCHES,
  TITLE_PRESETS,
  type Selections,
} from '../panelSelections';

interface PanelProject {
  id: string;
  artifactId: string;
  root: string;
  javaPackage: string;
  selections: Selections;
}

export function buildConfigureTab(preselectRoot?: string): TabRenderResult {
  const projects = buildProjects();
  const preselect = preselectRoot ? projects.find((candidate) => candidate.root === preselectRoot) : undefined;
  const state = {
    projects,
    preselectId: preselect?.id ?? null,
    titlePresets: TITLE_PRESETS,
    primarySwatches: PRIMARY_SWATCHES,
    accentSwatches: ACCENT_SWATCHES,
    backgroundSwatches: BACKGROUND_SWATCHES,
    features: FEATURES,
  };
  const stateJson = JSON.stringify(state).replace(/</g, '\\u003c');

  return {
    bodyHtml: bodyHtml(),
    styles: styles(),
    script: `const STATE=${stateJson};${clientScript()}`,
  };
}

export async function handleConfigureMessage(
  panel: vscode.WebviewPanel,
  msg: Record<string, unknown>,
  onRefresh?: () => void,
): Promise<void> {
  if (msg.type === 'generate') await handleGenerate(panel, msg, onRefresh);
  else if (msg.type === 'detectTheme') handleDetect(panel, msg);
  else if (msg.type === 'deploy') await handleDeploy(panel, msg);
}

function handleDetect(panel: vscode.WebviewPanel, message: Record<string, unknown>): void {
  const project = buildProjects().find((candidate) => candidate.id === message.projectId);
  const colors = project ? detectThemeColors(project.root) : [];
  panel.webview.postMessage({ tab: 'configure', type: 'detected', colors });
}

async function handleDeploy(panel: vscode.WebviewPanel, message: Record<string, unknown>): Promise<void> {
  const project = buildProjects().find((candidate) => candidate.id === message.projectId);
  if (!project) {
    panel.webview.postMessage({ tab: 'configure', type: 'deployStarted', ok: false });
    return;
  }
  panel.webview.postMessage({ tab: 'configure', type: 'deployStarted', ok: true });
  await deployLocal(project.root); // confirm modal + start/finish toasts live here
}

async function handleGenerate(
  panel: vscode.WebviewPanel,
  message: Record<string, unknown>,
  onRefresh?: () => void,
): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    panel.webview.postMessage({ tab: 'configure', type: 'result', ok: false, error: 'Trust this workspace to generate files.' });
    return;
  }
  const project = buildProjects().find((candidate) => candidate.id === message.projectId);
  if (!project) {
    panel.webview.postMessage({ tab: 'configure', type: 'result', ok: false, error: 'That project is no longer in the workspace.' });
    return;
  }
  const prerequisites = checkGenerationPrerequisites(project.root);
  if (!prerequisites.ok) {
    const detail = prerequisites.failures.join(' ');
    panel.webview.postMessage({ tab: 'configure', type: 'result', ok: false, error: detail });
    vscode.window.showErrorMessage(
      `Configuration and generation are disabled for this project: ${detail}`,
      { modal: true },
    );
    return;
  }
  try {
    const config = applySelections(project, message);
    saveConfig(project.root, config);
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Generating component micro-site' },
      () => Promise.resolve(runGeneration(project.root)),
    );
    panel.webview.postMessage({
      tab: 'configure',
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
    onRefresh?.();
  } catch (error) {
    panel.webview.postMessage({
      tab: 'configure',
      type: 'result',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ---------------------------------------------------- theme auto-detection */

/** Scan the project's clientlib CSS for brand-like colors, most relevant first. */
function detectThemeColors(projectRoot: string): string[] {
  const files: string[] = [];
  for (const jcrRootRelative of getAemAdapter().componentRoots) {
    const root = path.join(projectRoot, jcrRootRelative);
    if (fs.existsSync(root)) {
      collectCss(root, files, 0);
    }
  }
  if (files.length === 0) return [];
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

function bodyHtml(): string {
  return `<div class="cfg-form-width">
  <section class="card" id="cfg-noproject" hidden><p>No AEM as a Cloud Service project was found in this workspace.</p></section>

  <div id="cfg-form" hidden>
    <section class="card" id="cfg-projectcard">
      <label class="field-label" for="cfg-project">Project</label>
      <select id="cfg-project"></select>
    </section>

    <section class="card">
      <label class="field-label" for="cfg-brandInput">Brand name</label>
      <input id="cfg-brandInput" type="text" maxlength="40" placeholder="Acme"/>
      <p class="muted">Shown as the hero prefix — e.g. “<b>Acme</b> Component Catalog”.</p>
      <label class="field-label spaced" for="cfg-titleInput">Catalog title</label>
      <input id="cfg-titleInput" type="text" maxlength="80" placeholder="Component Catalog"/>
      <div class="pills small" id="cfg-titlePresets"></div>
      <label class="field-label spaced" for="cfg-descInput">Description <span class="muted">(optional)</span></label>
      <input id="cfg-descInput" type="text" maxlength="240" placeholder="Auto-filled from the brand name…"/>
    </section>

    <section class="card">
      <div class="row-head">
        <h2>Theme</h2>
        <button type="button" class="ghost" id="cfg-detect">Detect from workspace</button>
      </div>
      <p class="muted" id="cfg-detecthint" hidden></p>
      <label class="field-label">Primary</label>
      <div class="swatches" id="cfg-primary"></div>
      <label class="field-label spaced">Accent</label>
      <div class="swatches" id="cfg-accent"></div>
      <label class="field-label spaced">Background</label>
      <div class="swatches" id="cfg-background"></div>
      <label class="field-label spaced">Preview</label>
      <div class="preview" id="cfg-preview">
        <div class="preview-hero">
          <span class="preview-badge" id="cfg-previewBadge">Acme</span>
          <strong id="cfg-previewTitle">Component Catalog</strong>
          <span class="preview-btn" id="cfg-previewBtn">Browse components</span>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Sub-category (fallback)</h2>
      <label class="field-label" for="cfg-subcatInput">Use this property when a component defines it…</label>
      <input id="cfg-subcatInput" type="text" maxlength="60" placeholder="catalogSubCategory"/>
      <p class="muted">…otherwise it falls back automatically to the component's <code>componentGroup</code>.</p>
    </section>

    <section class="card">
      <h2>Site domains</h2>
      <p class="muted">"Where it's used" links are built from each page's raw content path — that only resolves when the catalog is opened from the same host that also serves <code>/content</code> directly (e.g. localhost). Once the catalog is opened from its own public domain, add each site's production and stage domain here to turn those links into working absolute URLs. Leave a domain blank to keep the old relative-link behavior for that site — nothing breaks either way.</p>
      <p class="muted"><strong>Content root, not category:</strong> the first column must be the site's actual JCR root segment under <code>/content</code> (e.g. <code>/content/acme-corp/en/…</code> → <code>acme-corp</code>) — check the real content tree if you're not sure. Rows are pre-filled from your component categories as a starting guess, but a site's content root often has a <em>different</em> name than its component category (e.g. category <code>corporate</code> might actually live under <code>/content/acme-corporate-site</code>) — edit each row to match before generating, or the link won't resolve.</p>
      <p class="muted"><strong>Path to strip:</strong> enter the exact leading path this site's own Dispatcher rewrite rules strip when serving a page — check that site's <code>dispatcher/src/conf.d/rewrites/rewrite.rules</code> to be sure, since it's project-specific. It's most commonly <code>/content/&lt;root&gt;</code> (the standard AEM Cloud archetype default — a public path like <code>/foo/bar.html</code> is rewritten internally to <code>/content/&lt;root&gt;/foo/bar.html</code>), but treat that as a starting guess, not a given. Leave it blank to link to the full raw path — always the safe choice when you haven't confirmed the site's rewrite behavior.</p>
      <div class="sitedomain-head">
        <span>Content root (under /content)</span><span>Production domain</span><span>Stage domain</span><span>Path to strip</span><span></span>
      </div>
      <div id="cfg-siteDomains"></div>
      <button type="button" class="ghost" id="cfg-addSiteDomain">+ Add site</button>
    </section>

    <section class="card">
      <h2>Features</h2>
      <div class="toggles" id="cfg-features"></div>
      <div class="governance">
        <label class="field-label spaced">Governance <span class="muted">(optional)</span></label>
        <div class="toggles" id="cfg-governanceFeatures"></div>
      </div>
    </section>

    <div class="footer">
      <div id="cfg-status" class="status"></div>
      <div class="footer-actions">
        <button id="cfg-deploy" class="ghost">Deploy to Local AEM</button>
        <button id="cfg-generate" class="primary">Generate Micro-site</button>
      </div>
    </div>
  </div>
</div>`;
}

function styles(): string {
  return `
#tab-configure .cfg-form-width{max-width:760px;margin:0 auto}
#tab-configure .card{background:var(--vscode-editorWidget-background,rgba(127,127,127,.08));border:1px solid var(--vscode-widget-border,rgba(127,127,127,.25));border-radius:10px;padding:16px 18px;margin-bottom:14px}
#tab-configure .card h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-descriptionForeground);margin:0 0 12px}
#tab-configure .row-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
#tab-configure .row-head h2{margin:0}
#tab-configure .field-label{display:block;font-size:12px;color:var(--vscode-descriptionForeground);margin:0 0 6px}
#tab-configure .field-label.spaced{margin-top:14px}
#tab-configure .muted{color:var(--vscode-descriptionForeground);font-size:12px;margin:8px 0 0}
#tab-configure input[type=text]{width:100%;padding:9px 11px;border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);font:inherit}
#tab-configure input[type=text]:focus{outline:none;border-color:var(--vscode-focusBorder)}
#tab-configure select{width:100%;padding:8px 10px;border-radius:6px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border,transparent);font:inherit}
#tab-configure .swatches{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#tab-configure .swatch{width:36px;height:36px;border-radius:9px;border:2px solid transparent;cursor:pointer;position:relative;outline:1px solid rgba(127,127,127,.3);padding:0}
#tab-configure .swatch:focus-visible{outline:2px solid var(--vscode-focusBorder,#4CADE9);outline-offset:2px}
#tab-configure .swatch.detected{outline:1px dashed var(--vscode-focusBorder,#4CADE9)}
#tab-configure .swatch.sel{border-color:var(--vscode-focusBorder,#4CADE9);box-shadow:0 0 0 2px var(--vscode-focusBorder,#4CADE9)}
#tab-configure .swatch.sel::after{content:"";position:absolute;inset:0;margin:auto;width:11px;height:6px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:rotate(-45deg) translate(1px,-2px);mix-blend-mode:difference}
#tab-configure .picker{width:36px;height:36px;padding:0;border:none;border-radius:9px;overflow:hidden;cursor:pointer;background:none;outline:1px dashed rgba(127,127,127,.5)}
#tab-configure .picker::-webkit-color-swatch-wrapper{padding:0}
#tab-configure .picker::-webkit-color-swatch{border:none;border-radius:9px}
#tab-configure .preview{border-radius:8px;overflow:hidden;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.3))}
#tab-configure .preview-hero{display:flex;align-items:center;gap:12px;padding:18px 16px;transition:background-color .15s}
#tab-configure .preview-badge{padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.04em;background:rgba(255,255,255,.22);color:inherit}
#tab-configure .preview-hero strong{flex:1;font-size:15px}
#tab-configure .preview-btn{padding:6px 12px;border-radius:6px;font-size:11px;font-weight:600;background:rgba(255,255,255,.9);color:#111}
#tab-configure .pills{display:flex;flex-wrap:wrap;gap:8px}
#tab-configure .pills.small{margin-top:10px}
#tab-configure .pill{padding:6px 12px;border-radius:20px;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.35));background:transparent;color:var(--vscode-foreground);cursor:pointer;font:inherit;font-size:12px}
#tab-configure .pill:hover{border-color:var(--vscode-focusBorder)}
#tab-configure .sitedomain-head{display:grid;grid-template-columns:1fr 1.3fr 1.3fr auto auto;gap:8px;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:6px;padding:0 2px}
#tab-configure .sitedomain-row{display:grid;grid-template-columns:1fr 1.3fr 1.3fr auto auto;gap:8px;margin-bottom:8px;align-items:center}
#tab-configure .sitedomain-row input[type=text]{width:100%;padding:8px 10px;font-size:12px}
#tab-configure .sitedomain-row .ghost{white-space:nowrap}
#tab-configure #cfg-addSiteDomain{margin-top:2px}
@media(max-width:560px){#tab-configure .sitedomain-row,#tab-configure .sitedomain-head{grid-template-columns:1fr}#tab-configure .sitedomain-head span:empty{display:none}}
#tab-configure .toggles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#tab-configure .toggle{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.25));border-radius:8px;cursor:pointer;background:none;font:inherit;color:inherit;width:100%;text-align:left}
#tab-configure .toggle:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
#tab-configure .toggle .track{flex:none;width:34px;height:20px;border-radius:20px;background:rgba(127,127,127,.4);position:relative;transition:.15s}
#tab-configure .toggle .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
#tab-configure .toggle.on .track{background:var(--vscode-button-background)}
#tab-configure .toggle.on .track::after{transform:translateX(14px)}
#tab-configure .toggle .meta{display:flex;flex-direction:column;gap:1px}
#tab-configure .toggle .meta b{font-weight:600}
#tab-configure .toggle .meta small{color:var(--vscode-descriptionForeground)}
#tab-configure .governance{margin-top:16px;padding-top:14px;border-top:1px dashed var(--vscode-widget-border,rgba(127,127,127,.3))}
#tab-configure .governance .toggle{opacity:.85}
#tab-configure .ghost{padding:6px 12px;border:1px solid var(--vscode-widget-border,rgba(127,127,127,.4));border-radius:6px;background:transparent;color:var(--vscode-foreground);cursor:pointer;font:inherit;font-size:12px}
#tab-configure .ghost:hover{border-color:var(--vscode-focusBorder)}
#tab-configure .footer{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0 0;background:var(--vscode-editor-background);border-top:1px solid var(--vscode-widget-border,rgba(127,127,127,.2));margin-top:8px}
#tab-configure .footer-actions{display:flex;gap:10px;align-items:center}
#tab-configure .status{font-size:12px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:10px}
#tab-configure .status.ok{color:var(--vscode-testing-iconPassed,#4CAF50)}
#tab-configure .status.err{color:var(--vscode-errorForeground,#f14c4c)}
#tab-configure .status .link{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:underline;background:none;border:none;font:inherit;padding:0}
#tab-configure code{background:rgba(127,127,127,.18);padding:1px 5px;border-radius:4px;font-family:var(--vscode-editor-font-family,monospace)}
#tab-configure button.primary{padding:11px 22px;border:none;border-radius:8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font:inherit;font-weight:600;cursor:pointer}
#tab-configure button.primary:hover{background:var(--vscode-button-hoverBackground)}
#tab-configure button.primary:disabled{opacity:.5;cursor:default}
@media(max-width:560px){#tab-configure .toggles{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){#tab-configure *{transition:none!important;animation:none!important}}
`;
}

function clientScript(): string {
  return `
const $=(id)=>document.getElementById(id);
let cur=null,detected=[];
function eq(a,b){return String(a).toLowerCase()===String(b).toLowerCase();}
function luminance(hex){const n=hex.replace('#','');if(!/^[0-9a-f]{6}$/i.test(n))return 0;const c=[0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
function selectProject(id){cur=STATE.projects.find(p=>p.id===id);detected=[];$('cfg-detecthint').hidden=true;renderAll();}
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
function renderSiteDomains(){
  const el=$('cfg-siteDomains');el.innerHTML='';
  cur.selections.siteDomains.forEach((row,i)=>{
    const wrap=document.createElement('div');wrap.className='sitedomain-row';
    const cat=document.createElement('input');cat.type='text';cat.placeholder='e.g. mysite (the /content root)';cat.maxLength=60;cat.value=row.category;cat.setAttribute('aria-label','Content root '+(i+1));
    cat.oninput=()=>{row.category=cat.value;};
    const prod=document.createElement('input');prod.type='text';prod.placeholder='https://www.example.com';prod.value=row.prodDomain;prod.setAttribute('aria-label','Production domain for '+(row.category||('content root '+(i+1))));
    prod.oninput=()=>{row.prodDomain=prod.value;};
    const stage=document.createElement('input');stage.type='text';stage.placeholder='https://stage.example.com';stage.value=row.stageDomain;stage.setAttribute('aria-label','Stage domain for '+(row.category||('content root '+(i+1))));
    stage.oninput=()=>{row.stageDomain=stage.value;};
    const shorten=document.createElement('input');shorten.type='text';shorten.placeholder='/content/'+(row.category||'mysite');shorten.value=row.shortenPath||'';shorten.setAttribute('aria-label','Path to strip for '+(row.category||('content root '+(i+1))));
    shorten.oninput=()=>{row.shortenPath=shorten.value;};
    const rm=document.createElement('button');rm.type='button';rm.className='ghost';rm.textContent='Remove';rm.setAttribute('aria-label','Remove '+(row.category||('content root '+(i+1))));
    rm.onclick=()=>{cur.selections.siteDomains.splice(i,1);renderSiteDomains();};
    wrap.appendChild(cat);wrap.appendChild(prod);wrap.appendChild(stage);wrap.appendChild(shorten);wrap.appendChild(rm);
    el.appendChild(wrap);
  });
}
function renderPreview(){
  const p=cur.selections;
  $('cfg-preview').querySelector('.preview-hero').style.background=/^#[0-9a-f]{6}$/i.test(p.primary)?p.primary:'#03438E';
  const dark=luminance(p.primary)>0.5;
  $('cfg-preview').querySelector('.preview-hero').style.color=dark?'#111':'#fff';
  $('cfg-previewBadge').textContent=p.brandName||'Brand';
  $('cfg-previewBadge').style.background=dark?'rgba(0,0,0,.12)':'rgba(255,255,255,.22)';
  $('cfg-previewTitle').textContent=p.title||'Component Catalog';
  $('cfg-previewBtn').style.background=/^#[0-9a-f]{6}$/i.test(p.accent)?p.accent:'#4CADE9';
  $('cfg-previewBtn').style.color=luminance(p.accent)>0.5?'#111':'#fff';
}
function renderAll(){
  $('cfg-brandInput').value=cur.selections.brandName;
  $('cfg-titleInput').value=cur.selections.title;
  $('cfg-descInput').value=cur.selections.description;
  $('cfg-subcatInput').value=cur.selections.subCategoryProperty;
  swatchRow('cfg-primary',STATE.primarySwatches,'primary');
  swatchRow('cfg-accent',STATE.accentSwatches,'accent');
  swatchRow('cfg-background',STATE.backgroundSwatches,'background');
  renderFeatureGroup('cfg-features','core');
  renderFeatureGroup('cfg-governanceFeatures','governance');
  renderSiteDomains();
  renderPreview();
}
function init(){
  if(!STATE.projects.length){$('cfg-noproject').hidden=false;return;}
  $('cfg-form').hidden=false;
  const sel=$('cfg-project');STATE.projects.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.artifactId;sel.appendChild(o);});
  sel.onchange=()=>selectProject(sel.value);
  if(STATE.projects.length<2)$('cfg-projectcard').hidden=true;
  renderPresets('cfg-titlePresets',STATE.titlePresets,v=>{cur.selections.title=v;$('cfg-titleInput').value=v;renderPreview();});
  $('cfg-brandInput').oninput=()=>{cur.selections.brandName=$('cfg-brandInput').value;renderPreview();};
  $('cfg-titleInput').oninput=()=>{cur.selections.title=$('cfg-titleInput').value;renderPreview();};
  $('cfg-descInput').oninput=()=>{cur.selections.description=$('cfg-descInput').value;};
  $('cfg-subcatInput').oninput=()=>{cur.selections.subCategoryProperty=$('cfg-subcatInput').value;};
  $('cfg-detect').onclick=()=>{$('cfg-detect').disabled=true;$('cfg-detect').textContent='Scanning…';vscode.postMessage({tab:'configure',type:'detectTheme',projectId:cur.id});};
  $('cfg-addSiteDomain').onclick=()=>{cur.selections.siteDomains.push({category:'',prodDomain:'',stageDomain:'',shortenPath:''});renderSiteDomains();};
  const preselectId=(STATE.preselectId&&STATE.projects.some(p=>p.id===STATE.preselectId))?STATE.preselectId:STATE.projects[0].id;
  sel.value=preselectId;
  selectProject(preselectId);
  $('cfg-generate').onclick=()=>{
    const st=$('cfg-status');st.className='status';st.textContent='Generating…';$('cfg-generate').disabled=true;
    vscode.postMessage({tab:'configure',type:'generate',projectId:cur.id,primary:cur.selections.primary,accent:cur.selections.accent,background:cur.selections.background,brandName:cur.selections.brandName,title:cur.selections.title,description:cur.selections.description,subCategoryProperty:cur.selections.subCategoryProperty,features:cur.selections.features,siteDomains:cur.selections.siteDomains});
  };
  $('cfg-deploy').onclick=()=>{vscode.postMessage({tab:'configure',type:'deploy',projectId:cur.id});};
}
window.addEventListener('message',e=>{const m=e.data;if(!m||m.tab!=='configure')return;
  if(m.type==='detected'){$('cfg-detect').disabled=false;$('cfg-detect').textContent='Detect from workspace';detected=Array.isArray(m.colors)?m.colors:[];
    const h=$('cfg-detecthint');h.hidden=false;h.textContent=detected.length?('Found '+detected.length+' brand color(s) in your clientlib CSS — shown with a dashed outline.'):'No brand colors detected in the workspace clientlib CSS.';
    swatchRow('cfg-primary',STATE.primarySwatches,'primary');swatchRow('cfg-accent',STATE.accentSwatches,'accent');swatchRow('cfg-background',STATE.backgroundSwatches,'background');renderPreview();}
  if(m.type==='deployStarted'){const st=$('cfg-status');st.className='status';st.textContent=m.ok?'Deploy started — confirm the prompt; watch the terminal + toast.':'Could not start deploy.';}
  if(m.type==='result'){
    $('cfg-generate').disabled=false;const st=$('cfg-status');st.innerHTML='';
    if(m.ok){
      st.className='status ok';
      const summary=document.createElement('span');summary.textContent='✓ Generated · '+m.created+' created · '+m.updated+' updated. Next: deploy, then open ';
      const path=document.createElement('code');path.textContent=m.authorPath;
      st.appendChild(summary);st.appendChild(path);
    }else{
      st.className='status err';st.textContent=m.error;
    }
  }
  if(m.type==='selectProject'&&m.projectId){
    const sel=$('cfg-project');
    if(sel){sel.value=m.projectId;selectProject(m.projectId);}
  }
});
init();
`;
}
