/**
 * Webview-based management dashboard for AEM Component Library Generator.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { detectAllProjects, ProjectInfo } from '../scanner/projectDetector';
import { scanComponents, ScanResult } from '../scanner/componentScanner';
import { configExists, loadConfig, saveConfig } from '../config/loader';
import { getDefaults } from '../config/defaults';
import { ComponentLibraryConfig } from '../config/schema';

let currentPanel: vscode.WebviewPanel | undefined;

export function openDashboard(context: vscode.ExtensionContext, onRefresh?: () => void): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'aemCLDashboard',
    'AEM Component Library',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  currentPanel.iconPath = vscode.Uri.file(
    path.join(context.extensionPath, 'resources', 'icon.svg'),
  );

  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot) {
    currentPanel.webview.html = errorHtml('No workspace folder open.');
    return;
  }

  // Send initial data
  refreshDashboard(currentPanel, wsRoot);

  // Handle messages from the webview
  currentPanel.webview.onDidReceiveMessage(
    async (msg) => {
      switch (msg.command) {
        case 'runAction':
          if (msg.action === 'generate') {
            // Validate config exists for at least one project before generate
            const projects = detectAllProjects(wsRoot);
            const hasAnyConfig = projects.some(p => configExists(p.root));
            if (!hasAnyConfig) {
              const choice = await vscode.window.showWarningMessage(
                'No .component-library.json found. Save your config first, then generate.',
                'Run Init',
              );
              if (choice === 'Run Init') {
                await vscode.commands.executeCommand('aemComponentLibrary.init');
                if (currentPanel) { refreshDashboard(currentPanel, wsRoot); }
              }
              return;
            }
          }
          await vscode.commands.executeCommand(`aemComponentLibrary.${msg.action}`);
          if (currentPanel) { refreshDashboard(currentPanel, wsRoot); }
          onRefresh?.();
          break;
        case 'generateProject':
          // Generate for a specific project root — validate config first
          if (!msg.projectRoot) {
            vscode.window.showErrorMessage('No project selected.');
            return;
          }
          if (!configExists(msg.projectRoot)) {
            vscode.window.showWarningMessage(
              'Config not saved yet. Click "Save Config" first, then "Generate".'
            );
            return;
          }
          try {
            loadConfig(msg.projectRoot);
          } catch (e: any) {
            vscode.window.showErrorMessage(`Config error: ${e.message}`, 'Open Config').then(choice => {
              if (choice === 'Open Config') {
                vscode.workspace.openTextDocument(vscode.Uri.file(`${msg.projectRoot}/.component-library.json`))
                  .then(doc => vscode.window.showTextDocument(doc));
              }
            });
            return;
          }
          await vscode.commands.executeCommand('aemComponentLibrary.generate');
          if (currentPanel) { refreshDashboard(currentPanel, wsRoot); }
          onRefresh?.();
          break;
        case 'saveConfig':
          try {
            // Validate before saving
            const validationErrors = validateConfigFromWebview(msg.config);
            if (validationErrors.length > 0) {
              vscode.window.showErrorMessage(
                `Config has errors:\n• ${validationErrors.join('\n• ')}`,
              );
              return;
            }
            saveConfig(msg.projectRoot, msg.config);
            vscode.window.showInformationMessage('Config saved successfully.');
            if (currentPanel) { refreshDashboard(currentPanel, wsRoot); }
          } catch (e: any) {
            vscode.window.showErrorMessage(`Save failed: ${e.message}`);
          }
          break;
        case 'openFile':
          try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.file));
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
          } catch {
            vscode.window.showErrorMessage(`Cannot open file: ${msg.file}`);
          }
          break;
        case 'refresh':
          if (currentPanel) { refreshDashboard(currentPanel, wsRoot); }
          break;
      }
    },
    undefined,
    context.subscriptions,
  );

  currentPanel.onDidDispose(() => { currentPanel = undefined; });
}

function refreshDashboard(panel: vscode.WebviewPanel, wsRoot: string): void {
  const projects = detectAllProjects(wsRoot);
  const data: DashboardData = {
    projects: projects.map(p => {
      const hasConfig = configExists(p.root);
      let config: ComponentLibraryConfig | null = null;
      let scan: ScanResult | null = null;
      try {
        config = hasConfig ? loadConfig(p.root) : null;
        const scanConfig = config || getDefaults(p.artifactId);
        scan = scanComponents(p.root, scanConfig);
      } catch { /* skip */ }
      return { info: p, hasConfig, config, scan };
    }),
  };
  panel.webview.html = getHtml(data);
}

interface DashboardProject {
  info: ProjectInfo;
  hasConfig: boolean;
  config: ComponentLibraryConfig | null;
  scan: ScanResult | null;
}

interface DashboardData {
  projects: DashboardProject[];
}

function errorHtml(msg: string): string {
  return `<!DOCTYPE html><html><body><h2>${msg}</h2></body></html>`;
}

/**
 * Validate config data from webview before saving.
 */
function validateConfigFromWebview(config: any): string[] {
  const errors: string[] = [];

  if (!config.appId || typeof config.appId !== 'string' || !config.appId.trim()) {
    errors.push('App ID is required');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(config.appId)) {
    errors.push('App ID must contain only letters, numbers, hyphens, and underscores');
  }

  if (config.output) {
    if (!config.output.servletPackage || !config.output.servletPackage.trim()) {
      errors.push('Servlet Package is required');
    } else if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(config.output.servletPackage)) {
      errors.push('Servlet Package must be a valid Java package (e.g. com.example.core.servlets)');
    }

    if (!config.output.contentPath || !config.output.contentPath.startsWith('/content/')) {
      errors.push('Content Path must start with /content/');
    }

    if (!config.output.pageResourceType || !config.output.pageResourceType.trim()) {
      errors.push('Page Resource Type is required');
    }

    if (!config.output.clientlibCategory || !config.output.clientlibCategory.trim()) {
      errors.push('Clientlib Category is required');
    }
  }

  if (config.serviceUser) {
    if (!config.serviceUser.name || !config.serviceUser.name.trim()) {
      errors.push('Service User Name is required');
    }
    if (!config.serviceUser.bundleSymbolicName || !config.serviceUser.bundleSymbolicName.trim()) {
      errors.push('Bundle Symbolic Name is required');
    }
  }

  // Brand color validation
  const hexPattern = /^#[0-9a-fA-F]{3,8}$/;
  if (config.brand) {
    const colorFields = ['primary', 'primaryLight', 'primaryDark', 'primaryDeeper', 'accent', 'accentHover', 'gold', 'sky', 'background'];
    for (const field of colorFields) {
      const val = config.brand[field];
      if (val && typeof val === 'string' && val.trim() && !hexPattern.test(val)) {
        errors.push(`Brand ${field} must be a valid hex color (got "${val}")`);
      }
    }
  }

  return errors;
}

function getHtml(data: DashboardData): string {
  const projectCards = data.projects.map((p, i) => buildProjectCard(p, i)).join('\n');
  const totalComponents = data.projects.reduce((s, p) => s + (p.scan?.total || 0), 0);
  const configuredCount = data.projects.filter(p => p.hasConfig).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #333);
    --card-bg: var(--vscode-sideBar-background, #1e1e1e);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #ccc);
    --input-border: var(--vscode-input-border, #555);
    --btn-bg: var(--vscode-button-background, #0e639c);
    --btn-fg: var(--vscode-button-foreground, #fff);
    --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --btn-secondary-bg: var(--vscode-button-secondaryBackground, #3a3d41);
    --btn-secondary-fg: var(--vscode-button-secondaryForeground, #ccc);
    --success: #4caf50;
    --warning: #ff9800;
    --accent: #4cade9;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 20px; }

  /* Header */
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .header h1 { font-size: 20px; font-weight: 600; }
  .header .subtitle { color: var(--vscode-descriptionForeground); font-size: 13px; }

  /* Stats row */
  .stats { display: flex; gap: 12px; margin-bottom: 24px; }
  .stat { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; flex: 1; text-align: center; }
  .stat .value { font-size: 24px; font-weight: 700; color: var(--accent); }
  .stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); margin-top: 4px; }

  /* Actions bar */
  .actions { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-family: inherit; display: inline-flex; align-items: center; gap: 6px; }
  .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
  .btn-primary:hover { background: var(--btn-hover); }
  .btn-secondary { background: var(--btn-secondary-bg); color: var(--btn-secondary-fg); }
  .btn-secondary:hover { opacity: 0.9; }
  .btn-success { background: var(--success); color: #fff; }
  .btn-warning { background: var(--warning); color: #000; }

  /* Project cards */
  .project-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .project-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; cursor: pointer; user-select: none; }
  .project-header:hover { background: rgba(255,255,255,0.03); }
  .project-title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
  .badge-ok { background: rgba(76,175,80,0.2); color: var(--success); }
  .badge-warn { background: rgba(255,152,0,0.2); color: var(--warning); }
  .project-body { display: none; padding: 0 16px 16px; }
  .project-body.open { display: block; }
  .chevron { transition: transform 0.2s; }
  .chevron.open { transform: rotate(90deg); }

  /* Tabs */
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
  .tab { padding: 8px 16px; cursor: pointer; font-size: 12px; border-bottom: 2px solid transparent; color: var(--vscode-descriptionForeground); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Form grid */
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-group.full { grid-column: 1 / -1; }
  .form-group label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
  .form-group input, .form-group select { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; padding: 6px 8px; font-size: 13px; font-family: inherit; }
  .form-group input[type="color"] { width: 40px; height: 30px; padding: 2px; cursor: pointer; }
  .color-row { display: flex; align-items: center; gap: 8px; }
  .color-row input[type="text"] { flex: 1; }

  /* Toggle */
  .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
  .toggle-label { font-size: 13px; }
  .toggle { position: relative; width: 36px; height: 20px; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle .slider { position: absolute; inset: 0; background: var(--input-border); border-radius: 10px; cursor: pointer; transition: 0.2s; }
  .toggle .slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.2s; }
  .toggle input:checked + .slider { background: var(--accent); }
  .toggle input:checked + .slider::before { transform: translateX(16px); }

  /* Component table */
  .comp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .comp-table th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--vscode-descriptionForeground); font-weight: 500; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
  .comp-table td { padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .comp-table tr:hover td { background: rgba(255,255,255,0.03); }
  .check { color: var(--success); }
  .dash { color: var(--vscode-descriptionForeground); }

  /* Scan summary */
  .scan-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
  .scan-stat { background: var(--input-bg); border-radius: 6px; padding: 10px; text-align: center; }
  .scan-stat .val { font-size: 18px; font-weight: 700; }
  .scan-stat .lbl { font-size: 10px; color: var(--vscode-descriptionForeground); text-transform: uppercase; margin-top: 2px; }

  /* Required field indicator */
  .form-group.required label::after { content: ' *'; color: #ff5252; }
  .form-group input:invalid { border-color: #ff5252; }
  .form-group input.error { border-color: #ff5252; background: rgba(255,82,82,0.05); }

  /* Status message */
  .status-msg { font-size: 12px; padding: 6px 10px; border-radius: 4px; margin-top: 8px; }
  .status-msg.error { background: rgba(255,82,82,0.1); color: #ff5252; }
  .status-msg.success { background: rgba(76,175,80,0.1); color: var(--success); }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>AEM Component Library Generator</h1>
    <div class="subtitle">Manage, configure and generate component libraries for your AEM projects</div>
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="value">${data.projects.length}</div><div class="label">Projects</div></div>
  <div class="stat"><div class="value">${configuredCount}</div><div class="label">Configured</div></div>
  <div class="stat"><div class="value">${totalComponents}</div><div class="label">Components</div></div>
</div>

<div class="actions">
  <button class="btn btn-primary" onclick="runAction('init')">⚙ Init Config</button>
  <button class="btn btn-success" onclick="runAction('generate')">▶ Generate</button>
  <button class="btn btn-secondary" onclick="runAction('update')">↻ Update</button>
  <button class="btn btn-secondary" onclick="runAction('preview')">👁 Preview</button>
  <button class="btn btn-secondary" onclick="runAction('scan')">🔍 Scan</button>
  <button class="btn btn-secondary" onclick="refresh()" style="margin-left:auto">↻ Refresh</button>
</div>

${projectCards}

<script>
  const vscode = acquireVsCodeApi();

  function runAction(action) { vscode.postMessage({ command: 'runAction', action }); }
  function refresh() { vscode.postMessage({ command: 'refresh' }); }
  function openFile(file) { vscode.postMessage({ command: 'openFile', file }); }

  function toggleProject(idx) {
    const body = document.getElementById('proj-body-' + idx);
    const chev = document.getElementById('proj-chev-' + idx);
    body.classList.toggle('open');
    chev.classList.toggle('open');
  }

  function switchTab(projIdx, tabName) {
    document.querySelectorAll('#proj-body-' + projIdx + ' .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#proj-body-' + projIdx + ' .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector('#proj-body-' + projIdx + ' .tab[data-tab="' + tabName + '"]').classList.add('active');
    document.getElementById('tab-' + projIdx + '-' + tabName).classList.add('active');
  }

  function validateForm(projIdx) {
    const form = document.getElementById('config-form-' + projIdx);
    if (!form) return [];

    const getValue = (name) => {
      const el = form.querySelector('[name="' + name + '"]');
      if (!el) return '';
      return el.value || '';
    };

    const errors = [];
    const hexPattern = /^#[0-9a-fA-F]{3,8}$/;

    // Required fields
    const appId = getValue('appId');
    if (!appId.trim()) {
      errors.push('App ID is required');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(appId)) {
      errors.push('App ID must contain only letters, numbers, hyphens, underscores');
    }

    const servletPkg = getValue('output.servletPackage');
    if (!servletPkg.trim()) {
      errors.push('Servlet Package is required');
    } else if (!/^[a-zA-Z][a-zA-Z0-9]*(\\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(servletPkg)) {
      errors.push('Servlet Package must be a valid Java package name');
    }

    const contentPath = getValue('output.contentPath');
    if (!contentPath.startsWith('/content/')) {
      errors.push('Content Path must start with /content/');
    }

    if (!getValue('output.pageResourceType').trim()) errors.push('Page Resource Type is required');
    if (!getValue('output.clientlibCategory').trim()) errors.push('Clientlib Category is required');
    if (!getValue('serviceUser.name').trim()) errors.push('Service User Name is required');
    if (!getValue('serviceUser.bundleSymbolicName').trim()) errors.push('Bundle Symbolic Name is required');

    // Color validation
    const colorFields = ['brand.primary', 'brand.primaryLight', 'brand.primaryDark', 'brand.primaryDeeper', 'brand.accent', 'brand.accentHover', 'brand.gold', 'brand.sky', 'brand.background'];
    for (const field of colorFields) {
      const val = getValue(field);
      if (val && val.trim() && !hexPattern.test(val)) {
        errors.push(field.replace('brand.', '') + ' must be a valid hex color');
      }
    }

    return errors;
  }

  function showValidationErrors(projIdx, errors) {
    const el = document.getElementById('validation-errors-' + projIdx);
    if (!el) return;
    if (errors.length === 0) {
      el.style.display = 'none';
      el.innerHTML = '';
    } else {
      el.style.display = 'block';
      el.innerHTML = '⚠ ' + errors.join('<br>⚠ ');
    }
  }

  function generateForProject(projIdx) {
    const errors = validateForm(projIdx);
    if (errors.length > 0) {
      showValidationErrors(projIdx, errors);
      return;
    }
    showValidationErrors(projIdx, []);
    const root = document.getElementById('proj-root-' + projIdx).value;
    vscode.postMessage({ command: 'generateProject', projectRoot: root });
  }

  function saveProjectConfig(projIdx) {
    const errors = validateForm(projIdx);
    if (errors.length > 0) {
      showValidationErrors(projIdx, errors);
      return;
    }
    showValidationErrors(projIdx, []);

    const root = document.getElementById('proj-root-' + projIdx).value;
    const form = document.getElementById('config-form-' + projIdx);
    if (!form) return;

    const getValue = (name) => {
      const el = form.querySelector('[name="' + name + '"]');
      if (!el) return undefined;
      if (el.type === 'checkbox') return el.checked;
      return el.value;
    };

    const config = {
      appId: getValue('appId'),
      projectType: getValue('projectType'),
      brand: {
        primary: getValue('brand.primary'),
        primaryLight: getValue('brand.primaryLight'),
        primaryDark: getValue('brand.primaryDark'),
        primaryDeeper: getValue('brand.primaryDeeper'),
        accent: getValue('brand.accent'),
        accentHover: getValue('brand.accentHover'),
        gold: getValue('brand.gold'),
        sky: getValue('brand.sky'),
        background: getValue('brand.background'),
        font: getValue('brand.font'),
        fontFallback: getValue('brand.fontFallback'),
      },
      features: {
        search: getValue('features.search'),
        groupFilters: getValue('features.groupFilters'),
        lightbox: getValue('features.lightbox'),
        codeSnippets: getValue('features.codeSnippets'),
        readme: getValue('features.readme'),
        darkMode: getValue('features.darkMode'),
      },
      output: {
        servletPackage: getValue('output.servletPackage'),
        clientlibCategory: getValue('output.clientlibCategory'),
        contentPath: getValue('output.contentPath'),
        pageTitle: getValue('output.pageTitle'),
        pageResourceType: getValue('output.pageResourceType'),
      },
      serviceUser: {
        name: getValue('serviceUser.name'),
        subServiceName: getValue('serviceUser.subServiceName'),
        bundleSymbolicName: getValue('serviceUser.bundleSymbolicName'),
      },
      hero: {
        badge: getValue('hero.badge'),
        titlePrefix: getValue('hero.titlePrefix'),
        titleHighlight: getValue('hero.titleHighlight'),
        description: getValue('hero.description'),
        footerText: getValue('hero.footerText'),
      },
    };

    const status = document.getElementById('config-status-' + projIdx);
    if (status) { status.textContent = 'Saving...'; status.style.color = 'var(--accent)'; }

    vscode.postMessage({ command: 'saveConfig', projectRoot: root, config });

    // Clear status after delay (dashboard will refresh on success)
    setTimeout(() => {
      if (status) { status.textContent = ''; }
    }, 3000);
  }
</script>
</body>
</html>`;
}

function buildProjectCard(p: DashboardProject, idx: number): string {
  const cfg = p.config || getDefaults(p.info.artifactId);
  const scan = p.scan;
  const statusBadge = p.hasConfig
    ? '<span class="badge badge-ok">Configured</span>'
    : '<span class="badge badge-warn">Not Configured</span>';

  const typeBadge = p.info.projectType === 'cloud'
    ? '<span class="badge badge-ok">AEMaaCS</span>'
    : '<span class="badge badge-warn">AEM AMS</span>';

  // Config form
  const configTab = buildConfigForm(cfg, p.info, idx);

  // Components tab
  const componentsTab = buildComponentsTab(scan, idx);

  // Info tab
  const infoTab = `
    <div class="form-grid">
      <div class="form-group"><label>Artifact ID</label><input value="${esc(p.info.artifactId)}" readonly></div>
      <div class="form-group"><label>Group ID</label><input value="${esc(p.info.groupId)}" readonly></div>
      <div class="form-group"><label>Version</label><input value="${esc(p.info.version)}" readonly></div>
      <div class="form-group"><label>Java Package</label><input value="${esc(p.info.javaPackage)}" readonly></div>
      <div class="form-group"><label>Project Type</label><input value="${p.info.projectType === 'cloud' ? 'AEMaaCS (Cloud)' : 'AEM AMS (6.x)'}" readonly></div>
      <div class="form-group"><label>Java Version</label><input value="${esc(p.info.javaVersion)}" readonly></div>
      <div class="form-group full"><label>Project Root</label><input value="${esc(p.info.root)}" readonly></div>
      <div class="form-group full"><label>Modules</label><input value="${esc(p.info.modules.join(', '))}" readonly></div>
      <div class="form-group full"><label>Content Strategy</label><input value="${p.info.projectType === 'cloud' ? 'RepoInit in ui.config (content page provisioned at runtime)' : 'File in ui.content (content page deployed via package)'}" readonly></div>
    </div>`;

  return `
<div class="project-card">
  <div class="project-header" onclick="toggleProject(${idx})">
    <div class="project-title">
      <span id="proj-chev-${idx}" class="chevron${idx === 0 ? ' open' : ''}">▶</span>
      ${esc(p.info.artifactId)}
      ${typeBadge}
      ${statusBadge}
    </div>
    <span style="font-size:12px;color:var(--vscode-descriptionForeground)">${scan ? scan.total + ' components' : '—'}</span>
  </div>
  <div id="proj-body-${idx}" class="project-body${idx === 0 ? ' open' : ''}">
    <input type="hidden" id="proj-root-${idx}" value="${esc(p.info.root)}">
    <div class="tabs">
      <div class="tab active" data-tab="config" onclick="switchTab(${idx},'config')">Configuration</div>
      <div class="tab" data-tab="components" onclick="switchTab(${idx},'components')">Components</div>
      <div class="tab" data-tab="info" onclick="switchTab(${idx},'info')">Project Info</div>
    </div>
    <div id="tab-${idx}-config" class="tab-content active">${configTab}</div>
    <div id="tab-${idx}-components" class="tab-content">${componentsTab}</div>
    <div id="tab-${idx}-info" class="tab-content">${infoTab}</div>
  </div>
</div>`;
}

function buildConfigForm(cfg: ComponentLibraryConfig, info: ProjectInfo, idx: number): string {
  const colorField = (label: string, name: string, value: string) => `
    <div class="form-group">
      <label>${label}</label>
      <div class="color-row">
        <input type="color" value="${esc(value)}" onchange="this.nextElementSibling.value=this.value" oninput="this.nextElementSibling.value=this.value">
        <input type="text" name="${name}" value="${esc(value)}" onchange="this.previousElementSibling.value=this.value">
      </div>
    </div>`;

  const textField = (label: string, name: string, value: string, full = false, required = false) => `
    <div class="form-group${full ? ' full' : ''}${required ? ' required' : ''}">
      <label>${label}</label>
      <input type="text" name="${name}" value="${esc(value)}"${required ? ' required' : ''}>
    </div>`;

  const toggle = (label: string, name: string, checked: boolean) => `
    <div class="toggle-row">
      <span class="toggle-label">${label}</span>
      <label class="toggle"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span class="slider"></span></label>
    </div>`;

  return `
<form id="config-form-${idx}" onsubmit="event.preventDefault(); saveProjectConfig(${idx})">
  <input type="hidden" name="projectType" value="${esc(cfg.projectType || info.projectType)}">
  <h3 style="font-size:13px;margin-bottom:12px;color:var(--accent)">Brand Colors</h3>
  <div class="form-grid">
    ${colorField('Primary', 'brand.primary', cfg.brand.primary)}
    ${colorField('Primary Light', 'brand.primaryLight', cfg.brand.primaryLight)}
    ${colorField('Primary Dark', 'brand.primaryDark', cfg.brand.primaryDark)}
    ${colorField('Primary Deeper', 'brand.primaryDeeper', cfg.brand.primaryDeeper)}
    ${colorField('Accent', 'brand.accent', cfg.brand.accent)}
    ${colorField('Accent Hover', 'brand.accentHover', cfg.brand.accentHover)}
    ${colorField('Gold', 'brand.gold', cfg.brand.gold)}
    ${colorField('Sky', 'brand.sky', cfg.brand.sky)}
    ${colorField('Background', 'brand.background', cfg.brand.background)}
    ${textField('Font', 'brand.font', cfg.brand.font)}
    ${textField('Font Fallback', 'brand.fontFallback', cfg.brand.fontFallback)}
  </div>

  <h3 style="font-size:13px;margin:16px 0 12px;color:var(--accent)">Features</h3>
  ${toggle('Search', 'features.search', cfg.features.search)}
  ${toggle('Group Filters', 'features.groupFilters', cfg.features.groupFilters)}
  ${toggle('Lightbox', 'features.lightbox', cfg.features.lightbox)}
  ${toggle('Code Snippets', 'features.codeSnippets', cfg.features.codeSnippets)}
  ${toggle('README', 'features.readme', cfg.features.readme)}
  ${toggle('Dark Mode', 'features.darkMode', cfg.features.darkMode)}

  <h3 style="font-size:13px;margin:16px 0 12px;color:var(--accent)">Output</h3>
  <div class="form-grid">
    ${textField('App ID', 'appId', cfg.appId, false, true)}
    ${textField('Page Title', 'output.pageTitle', cfg.output.pageTitle)}
    ${textField('Servlet Package', 'output.servletPackage', cfg.output.servletPackage, true, true)}
    ${textField('Clientlib Category', 'output.clientlibCategory', cfg.output.clientlibCategory, false, true)}
    ${textField('Content Path', 'output.contentPath', cfg.output.contentPath, false, true)}
    ${textField('Page Resource Type', 'output.pageResourceType', cfg.output.pageResourceType, true, true)}
  </div>

  <h3 style="font-size:13px;margin:16px 0 12px;color:var(--accent)">Service User</h3>
  <div class="form-grid">
    ${textField('Service User Name', 'serviceUser.name', cfg.serviceUser.name, false, true)}
    ${textField('Sub-Service Name', 'serviceUser.subServiceName', cfg.serviceUser.subServiceName)}
    ${textField('Bundle Symbolic Name', 'serviceUser.bundleSymbolicName', cfg.serviceUser.bundleSymbolicName, true, true)}
  </div>

  <h3 style="font-size:13px;margin:16px 0 12px;color:var(--accent)">Hero Section</h3>
  <div class="form-grid">
    ${textField('Badge', 'hero.badge', cfg.hero.badge)}
    ${textField('Title Prefix', 'hero.titlePrefix', cfg.hero.titlePrefix)}
    ${textField('Title Highlight', 'hero.titleHighlight', cfg.hero.titleHighlight)}
    ${textField('Description', 'hero.description', cfg.hero.description, true)}
    ${textField('Footer Text', 'hero.footerText', cfg.hero.footerText, true)}
  </div>

  <div style="margin-top:16px;display:flex;gap:8px;align-items:center">
    <button type="submit" class="btn btn-primary">💾 Save Config</button>
    <button type="button" class="btn btn-success" onclick="generateForProject(${idx})">▶ Generate</button>
    <button type="button" class="btn btn-secondary" onclick="openFile('${esc(info.root + '/.component-library.json')}')">📄 Open JSON</button>
    <span id="config-status-${idx}" style="font-size:12px;margin-left:8px"></span>
  </div>
  <div id="validation-errors-${idx}" style="margin-top:8px;color:#ff5252;font-size:12px;display:none"></div>
</form>`;
}

function buildComponentsTab(scan: ScanResult | null, idx: number): string {
  if (!scan || scan.total === 0) {
    return '<p style="color:var(--vscode-descriptionForeground)">No components found. Run a scan first.</p>';
  }

  const groups = Object.entries(scan.groups).sort((a, b) => b[1] - a[1]);
  const withDialog = scan.components.filter(c => c.hasDialog).length;
  const withReadme = scan.components.filter(c => c.hasReadme).length;
  const withThumb = scan.components.filter(c => c.hasThumbnail).length;
  const withLayouts = scan.components.filter(c => c.layoutFiles.length > 0).length;

  const rows = scan.components
    .sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title))
    .map(c => `
      <tr>
        <td><strong>${esc(c.title)}</strong></td>
        <td style="color:var(--vscode-descriptionForeground)">${esc(c.name)}</td>
        <td>${esc(c.group.replace(/.*-\s*/, ''))}</td>
        <td class="${c.hasDialog ? 'check' : 'dash'}">${c.hasDialog ? '✓' : '—'}</td>
        <td class="${c.hasReadme ? 'check' : 'dash'}">${c.hasReadme ? '✓' : '—'}</td>
        <td class="${c.hasThumbnail ? 'check' : 'dash'}">${c.hasThumbnail ? '✓' : '—'}</td>
        <td>${c.layoutFiles.length > 0 ? c.layoutFiles.length : '<span class="dash">—</span>'}</td>
      </tr>`).join('');

  return `
    <div class="scan-grid">
      <div class="scan-stat"><div class="val">${scan.total}</div><div class="lbl">Components</div></div>
      <div class="scan-stat"><div class="val">${groups.length}</div><div class="lbl">Groups</div></div>
      <div class="scan-stat"><div class="val">${withDialog}</div><div class="lbl">With Dialog</div></div>
      <div class="scan-stat"><div class="val">${withReadme}</div><div class="lbl">With README</div></div>
    </div>
    <table class="comp-table">
      <thead><tr><th>Title</th><th>Name</th><th>Group</th><th>Dialog</th><th>README</th><th>Thumb</th><th>Layouts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
