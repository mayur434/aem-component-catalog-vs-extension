import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', async () => {
  const { vscodeMock } = await import('../helpers/vscodeMock');
  return vscodeMock;
});
import { vscodeMock, resetVscodeMock, setWorkspaceFolders, setWorkspaceTrusted, getLastPanel } from '../helpers/vscodeMock';
import { createAemCloudFixture, type AemFixture } from '../helpers/fixture';
import { projectId } from '../../src/utils/webviewHelpers';
import { openCatalogPanel, type CatalogTab } from '../../src/webview/catalogPanel';
import type * as vscode from 'vscode';

/**
 * catalogPanel.ts is the orchestrator that assembles the Overview / Configure /
 * Audit tab modules into one webview document. These tests exercise it as the
 * integration point where earlier real bugs were found and fixed:
 *  - duplicate DOM ids across tabs (getElementById only ever finding the first)
 *  - a missing per-tab IIFE wrapper letting one tab's top-level declarations
 *    silently clobber another's
 *  - acquireVsCodeApi() being callable more than once (VS Code throws if a
 *    webview calls it twice in one session)
 *  - a missing 'tab' field on an outgoing postMessage, which would make the
 *    orchestrator's message router silently drop the message
 */

function fakeContext(): vscode.ExtensionContext {
  return {
    extensionUri: { fsPath: '/fake/extension/root' },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  for (;;) {
    index = haystack.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}

/**
 * openCatalogPanel keeps a module-level `currentPanel` singleton, so any test
 * asserting "no panel exists yet" needs a catalogPanel.ts instance nobody else
 * has touched. vi.resetModules() clears the regular module registry, forcing a
 * fresh evaluation of catalogPanel.ts (and thus a fresh `currentPanel ===
 * undefined`) the next time it's imported.
 *
 * Critically, this does NOT require re-importing the vscode-mock helper too:
 * vi.mock('vscode', ...) registrations live in a separate mock registry that
 * vi.resetModules() explicitly leaves alone, so 'vscode' keeps resolving — in
 * every module that imports it, freshly re-evaluated or not — to the exact
 * same vscodeMock singleton imported statically above. (Verified directly:
 * re-importing '../helpers/vscodeMock' after vi.resetModules() actually
 * yields a second, disconnected instance that the freshly re-imported
 * catalogPanel.ts does *not* talk to — only the original static import does.
 * So the static vscodeMock/getLastPanel/setWorkspaceFolders bindings above
 * are the ones to use, always.)
 */
async function freshOpenCatalogPanel(): Promise<typeof openCatalogPanel> {
  vi.resetModules();
  const fresh = await import('../../src/webview/catalogPanel');
  return fresh.openCatalogPanel;
}

describe('catalogPanel', () => {
  beforeEach(() => {
    resetVscodeMock();
    setWorkspaceTrusted(true);
  });

  describe('render(): shell + tab assembly', () => {
    it('creates exactly one panel and renders all three tab sections, showing only the requested initial tab', async () => {
      const open = await freshOpenCatalogPanel();
      setWorkspaceFolders([]);

      open(fakeContext(), { tab: 'overview' });

      expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
      const html = getLastPanel().webview.html;
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);

      expect(html).toContain('<section class="tab-panel" id="tab-overview"');
      expect(html).toContain('<section class="tab-panel" id="tab-configure"');
      expect(html).toContain('<section class="tab-panel" id="tab-audit"');

      const overviewOpenTag = /<section class="tab-panel" id="tab-overview"[^>]*>/.exec(html)?.[0];
      const configureOpenTag = /<section class="tab-panel" id="tab-configure"[^>]*>/.exec(html)?.[0];
      const auditOpenTag = /<section class="tab-panel" id="tab-audit"[^>]*>/.exec(html)?.[0];
      expect(overviewOpenTag).toBeDefined();
      expect(configureOpenTag).toBeDefined();
      expect(auditOpenTag).toBeDefined();

      // 'overview' was requested as the initial tab: its section must not carry
      // the `hidden` attribute, while the other two (not selected) must.
      expect(overviewOpenTag).not.toMatch(/\bhidden\b/);
      expect(configureOpenTag).toMatch(/\bhidden\b/);
      expect(auditOpenTag).toMatch(/\bhidden\b/);
    });

    it('calls acquireVsCodeApi exactly once — only the shared shell may call it, never an individual tab script', async () => {
      const open = await freshOpenCatalogPanel();
      setWorkspaceFolders([]);
      open(fakeContext(), { tab: 'overview' });

      const html = getLastPanel().webview.html;
      expect(countOccurrences(html, 'acquireVsCodeApi')).toBe(1);
    });

    it('wraps exactly three tab scripts in their own (function(vscode){ ... }) IIFE, one per tab', async () => {
      const open = await freshOpenCatalogPanel();
      setWorkspaceFolders([]);
      open(fakeContext(), { tab: 'overview' });

      const html = getLastPanel().webview.html;
      expect(countOccurrences(html, '(function(vscode){')).toBe(3);
    });

    it('never emits a duplicate DOM id across the assembled document', async () => {
      const open = await freshOpenCatalogPanel();
      setWorkspaceFolders([]);
      open(fakeContext(), { tab: 'overview' });

      const html = getLastPanel().webview.html;
      const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes a tab field on every client-side vscode.postMessage(...) call site', async () => {
      const open = await freshOpenCatalogPanel();
      setWorkspaceFolders([]);
      open(fakeContext(), { tab: 'overview' });

      const html = getLastPanel().webview.html;
      const postMessageCalls = [...html.matchAll(/postMessage\(\{[^}]*\}/g)].map((match) => match[0]);
      expect(postMessageCalls.length).toBeGreaterThan(0);
      for (const call of postMessageCalls) {
        expect(call).toMatch(/tab\s*:\s*['"]/);
      }
    });
  });

  describe('openCatalogPanel(): singleton reuse', () => {
    it('reuses the existing panel on a second call instead of creating a new one, revealing it and pushing an activateTab message', () => {
      // Deliberately uses the file's static top-level openCatalogPanel (not
      // freshOpenCatalogPanel()) so both calls below share the same
      // module-level `currentPanel` singleton — that's exactly the behavior
      // under test. No other test in this file touches this static binding,
      // so its singleton is guaranteed unset when this test starts.
      setWorkspaceFolders([]);

      openCatalogPanel(fakeContext(), { tab: 'overview' } as { tab: CatalogTab });
      expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledTimes(1);

      openCatalogPanel(fakeContext(), { tab: 'configure' } as { tab: CatalogTab });
      expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledTimes(1);

      const panel = getLastPanel();
      expect(panel.reveal).toHaveBeenCalled();
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        tab: '_shell',
        type: 'activateTab',
        activeTab: 'configure',
      });
    });
  });

  describe('message routing', () => {
    let fixture: AemFixture | undefined;

    afterEach(() => {
      fixture?.cleanup();
      fixture = undefined;
    });

    it('routes an overview action message to executeCommand, pushes an Overview refresh afterward, and calls onRefresh', async () => {
      fixture = createAemCloudFixture();
      const open = await freshOpenCatalogPanel();
      setWorkspaceFolders([fixture.root]);
      const onRefresh = vi.fn();

      open(fakeContext(), { tab: 'overview' }, onRefresh);
      const panel = getLastPanel();
      const postMessageCallsBefore = panel.webview.postMessage.mock.calls.length;

      await panel.emitMessage({ tab: 'overview', action: 'preview', projectId: projectId(fixture.root) });

      expect(vscodeMock.commands.executeCommand).toHaveBeenCalledWith(
        'aemComponentLibrary.preview',
        fixture.root,
      );
      expect(panel.webview.postMessage.mock.calls.length).toBeGreaterThan(postMessageCallsBefore);
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ tab: 'overview', type: 'refreshHtml' }),
      );
      expect(onRefresh).toHaveBeenCalled();
    });

    it('drops a message missing the tab field without routing it, refreshing Overview, or calling onRefresh', async () => {
      fixture = createAemCloudFixture();
      const open = await freshOpenCatalogPanel();
      setWorkspaceFolders([fixture.root]);
      const onRefresh = vi.fn();

      open(fakeContext(), { tab: 'overview' }, onRefresh);
      const panel = getLastPanel();
      const postMessageCallsBefore = panel.webview.postMessage.mock.calls.length;

      await panel.emitMessage({ action: 'preview', projectId: 'whatever' });

      expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalled();
      expect(panel.webview.postMessage.mock.calls.length).toBe(postMessageCallsBefore);
      expect(onRefresh).not.toHaveBeenCalled();
    });
  });
});
