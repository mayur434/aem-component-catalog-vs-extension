import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', async () => {
  const { vscodeMock } = await import('../helpers/vscodeMock');
  return vscodeMock;
});
import { vscodeMock, resetVscodeMock, setWorkspaceFolders, setWorkspaceTrusted } from '../helpers/vscodeMock';
import { createAemCloudFixture, type AemFixture } from '../helpers/fixture';
import { projectId } from '../../src/utils/webviewHelpers';
import { buildConfigureTab, handleConfigureMessage } from '../../src/webview/catalogTabs/configureTab';

let fixture: AemFixture | undefined;

beforeEach(() => {
  resetVscodeMock();
});

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

describe('buildConfigureTab', () => {
  it('renders the empty-state element when there are zero workspace folders', () => {
    setWorkspaceFolders([]);
    const { bodyHtml } = buildConfigureTab();
    expect(bodyHtml).toContain('id="cfg-noproject"');
  });

  it('renders form fields and scoped styles for a real fixture project, with no preselectRoot', () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const { bodyHtml, styles, script } = buildConfigureTab();

    // Spot-check form field ids prefixed 'cfg-'.
    expect(bodyHtml).toContain('id="cfg-project"');
    expect(bodyHtml).toContain('id="cfg-brandInput"');
    expect(bodyHtml).toContain('id="cfg-generate"');
    expect(bodyHtml).toContain('id="cfg-deploy"');

    // Spot-check selectors scoped under '#tab-configure '.
    expect(styles).toContain('#tab-configure .card');
    expect(styles).toContain('#tab-configure .swatch');
    expect(styles).toContain('#tab-configure .footer');

    // A tab module must never call acquireVsCodeApi - only the orchestrator does, once.
    expect(script).not.toContain('acquireVsCodeApi');
  });

  it('embeds the preselected project id in STATE.preselectId when preselectRoot is given', () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const expectedId = projectId(fixture.root);

    const { script } = buildConfigureTab(fixture.root);

    expect(script).toContain(`"preselectId":"${expectedId}"`);
  });
});

describe('handleConfigureMessage', () => {
  it('replies to detectTheme with tab + type set correctly (the tab field was a real regression)', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleConfigureMessage(panel as any, { type: 'detectTheme', projectId: projectId(fixture.root) }, undefined);

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'configure', type: 'detected' }),
    );
  });

  it('replies to deploy with deployStarted/ok:false when the projectId does not match any project', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleConfigureMessage(panel as any, { type: 'deploy', projectId: 'nonexistent0000' }, undefined);

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      tab: 'configure',
      type: 'deployStarted',
      ok: false,
    });
  });

  it('refuses to generate in an untrusted workspace, without calling onRefresh', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    setWorkspaceTrusted(false);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');
    const onRefresh = vi.fn();

    await handleConfigureMessage(
      panel as any,
      {
        type: 'generate',
        projectId: projectId(fixture.root),
        primary: '#000000',
        accent: '#000000',
        background: '#ffffff',
        brandName: 'Test',
        title: 'Test Catalog',
        description: '',
        subCategoryProperty: 'catalogSubCategory',
        features: {},
        siteDomains: [],
      },
      onRefresh,
    );

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      tab: 'configure',
      type: 'result',
      ok: false,
      error: 'Trust this workspace to generate files.',
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('generates the micro-site in a trusted workspace and calls onRefresh exactly once', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    setWorkspaceTrusted(true);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');
    const onRefresh = vi.fn();

    await handleConfigureMessage(
      panel as any,
      {
        type: 'generate',
        projectId: projectId(fixture.root),
        primary: '#000000',
        accent: '#000000',
        background: '#ffffff',
        brandName: 'Test',
        title: 'Test Catalog',
        description: '',
        subCategoryProperty: 'catalogSubCategory',
        features: {},
        siteDomains: [],
      },
      onRefresh,
    );

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'configure', type: 'result', ok: true }),
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
