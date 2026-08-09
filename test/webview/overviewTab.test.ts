import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', async () => {
  const { vscodeMock } = await import('../helpers/vscodeMock');
  return vscodeMock;
});
import { vscodeMock, resetVscodeMock, setWorkspaceFolders } from '../helpers/vscodeMock';
import { createAemCloudFixture, type AemFixture } from '../helpers/fixture';
import { projectId } from '../../src/utils/webviewHelpers';
// then import the actual module under test:
import { buildOverviewTab, handleOverviewMessage, refreshOverviewHtml } from '../../src/webview/catalogTabs/overviewTab';

let fixture: AemFixture | undefined;

beforeEach(() => {
  resetVscodeMock();
});

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

describe('buildOverviewTab', () => {
  it('renders the empty-state element when there are zero workspace folders', () => {
    setWorkspaceFolders([]);
    const { bodyHtml } = buildOverviewTab();
    expect(bodyHtml).toContain('id="ov-noproject"');
  });

  it('renders a real fixture project, wrapping content in a single #ov-content element', () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const { bodyHtml, styles, script } = buildOverviewTab();

    expect(bodyHtml).toContain('sample-site');

    // Regression test: the #ov-content wrapper must appear exactly once - it was
    // previously being double-included.
    const wrapperOccurrences = bodyHtml.split('id="ov-content"').length - 1;
    expect(wrapperOccurrences).toBe(1);

    // Spot check that top-level selectors are scoped under #tab-overview.
    expect(styles).toContain('#tab-overview .metric');
    expect(styles).toContain('#tab-overview .eyebrow');
    expect(styles).toContain('#tab-overview .actions');

    // A tab module must never call acquireVsCodeApi - only the orchestrator does, once.
    expect(script).not.toContain('acquireVsCodeApi');
  });
});

describe('refreshOverviewHtml', () => {
  it('returns unwrapped inner content, never containing the #ov-content id itself', () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);

    const refreshed = refreshOverviewHtml();
    expect(refreshed).not.toContain('id="ov-content"');
    // Sanity: it still contains real content for the fixture project.
    expect(refreshed).toContain('sample-site');
  });
});

describe('handleOverviewMessage', () => {
  it('does nothing for a message missing an action', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleOverviewMessage(panel as any, { projectId: projectId(fixture.root) });

    expect(vscodeMock.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('does nothing for a message with an action outside the allowed set', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleOverviewMessage(panel as any, {
      action: 'deleteEverything',
      projectId: projectId(fixture.root),
    });

    expect(vscodeMock.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('does nothing for a message with a malformed (non 16-hex-char) projectId', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleOverviewMessage(panel as any, {
      action: 'deployLocal',
      projectId: 'not-a-valid-id',
    });

    expect(vscodeMock.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('shows an error when the projectId does not match any discovered project', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    const realId = projectId(fixture.root);
    const bogusId = realId === '0000000000000000' ? '1111111111111111' : '0000000000000000';

    await handleOverviewMessage(panel as any, {
      action: 'deployLocal',
      projectId: bogusId,
    });

    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('executes the aemComponentLibrary.deployLocal command with the project root for a matching deployLocal action', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleOverviewMessage(panel as any, {
      action: 'deployLocal',
      projectId: projectId(fixture.root),
    });

    expect(vscodeMock.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscodeMock.commands.executeCommand).toHaveBeenCalledTimes(1);
    expect(vscodeMock.commands.executeCommand).toHaveBeenCalledWith(
      'aemComponentLibrary.deployLocal',
      fixture.root,
    );
  });

  it('posts activateTab + selectProject messages (and does not execute a command) for openConfig', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');
    const matchingId = projectId(fixture.root);

    await handleOverviewMessage(panel as any, {
      action: 'openConfig',
      projectId: matchingId,
    });

    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);
    expect(panel.webview.postMessage).toHaveBeenNthCalledWith(1, {
      tab: '_shell',
      type: 'activateTab',
      activeTab: 'configure',
    });
    expect(panel.webview.postMessage).toHaveBeenNthCalledWith(2, {
      tab: 'configure',
      type: 'selectProject',
      projectId: matchingId,
    });

    // The old removed dashboard used to call an 'aemComponentLibrary.configure' command
    // here - openConfig must only post messages, never execute a command.
    expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscodeMock.window.showErrorMessage).not.toHaveBeenCalled();
  });
});
