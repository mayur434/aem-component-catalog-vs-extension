import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', async () => {
  const { vscodeMock } = await import('../helpers/vscodeMock');
  return vscodeMock;
});
import { vscodeMock, resetVscodeMock, setWorkspaceFolders } from '../helpers/vscodeMock';
import { createAemCloudFixture, type AemFixture } from '../helpers/fixture';
import { projectId } from '../../src/utils/webviewHelpers';
// then import the actual module under test:
import { buildAuditTab, handleAuditMessage } from '../../src/webview/catalogTabs/auditTab';

let fixture: AemFixture | undefined;

/**
 * The embedded client script is `const STATE=<json>;\n<rest of script>` (see
 * buildAuditTab() in the source) - JSON.stringify never emits a literal
 * newline, so the whole STATE assignment lives on the script's first line.
 */
function extractState(script: string): { projects: unknown[]; preselectId?: string } {
  const firstLine = script.split('\n')[0];
  const match = firstLine.match(/^const STATE=(.*);$/);
  if (!match) throw new Error(`Could not find STATE assignment in script; first line was: ${firstLine}`);
  return JSON.parse(match[1]);
}

beforeEach(() => {
  resetVscodeMock();
});

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

describe('buildAuditTab', () => {
  it('renders the empty-state element when there are zero workspace folders', () => {
    setWorkspaceFolders([]);
    const { bodyHtml } = buildAuditTab();
    expect(bodyHtml).toContain('id="aud-noproject"');
  });

  it('renders a real fixture project with aud- prefixed ids, unscoped shared :root doc comment, #tab-audit scoped rules, and no acquireVsCodeApi', () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const { bodyHtml, styles, script } = buildAuditTab();

    expect(bodyHtml).toContain('id="aud-projectList"');
    expect(bodyHtml).toContain('id="aud-runBtn"');
    expect(bodyHtml).toContain('id="aud-resultsSection"');

    // The shared :root custom-property variables are documented (not redefined)
    // here, on the understanding they are declared once, globally, in
    // catalogPanel.ts's shellStyles() - this comment is a deliberate,
    // documented exception to the "everything scoped under #tab-audit" rule,
    // not a bug.
    expect(styles).toContain(':root custom properties');

    // Everything else (the actual rules) is scoped under '#tab-audit '.
    expect(styles).toContain('#tab-audit .card{');
    expect(styles).toContain('#tab-audit .run-btn{');
    expect(styles).toContain('#tab-audit .project-list{');

    // A tab module must never call acquireVsCodeApi - only the orchestrator does, once.
    expect(script).not.toContain('acquireVsCodeApi');
  });

  it('embeds a preselectId in STATE matching projectId(preselectRoot) when a preselectRoot is passed', () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const { script } = buildAuditTab(fixture.root);

    const state = extractState(script);
    expect(state.preselectId).toBe(projectId(fixture.root));
  });
});

describe('handleAuditMessage', () => {
  // This test must run before any successful runAudit call in this file - the
  // source keeps its own module-level `lastAuditResult` state, and once a
  // runAudit call succeeds that state persists for the remainder of this
  // file's process. Running this first genuinely exercises the "no prior
  // audit" refusal path rather than accidentally inheriting a populated one.
  it('refuses to export (via showErrorMessage) when no audit has completed yet', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleAuditMessage(panel as any, { tab: 'audit', type: 'exportExcel' });

    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith(
      'No audit results available. Run the audit first.',
    );
    expect(vscodeMock.window.showSaveDialog).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('posts an auditError with "No projects selected." when projectIds is empty', async () => {
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleAuditMessage(panel as any, {
      tab: 'audit',
      type: 'runAudit',
      projectIds: [],
      contentPaths: [],
      duplicateThreshold: 50,
    });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      tab: 'audit',
      type: 'auditError',
      error: 'No projects selected.',
    });
  });

  it('calls showOpenDialog for browsePackages', async () => {
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');

    await handleAuditMessage(panel as any, { tab: 'audit', type: 'browsePackages' });

    expect(vscodeMock.window.showOpenDialog).toHaveBeenCalled();
  });

  // THE MAIN INTEGRATION TEST: runs the real audit engine (runAudit ->
  // classification -> serialization) against the real fixture directory on
  // disk - nothing here is mocked beyond the vscode module surface.
  it('runs the real audit engine end-to-end and posts an auditComplete result matching the fixture', async () => {
    fixture = createAemCloudFixture();
    setWorkspaceFolders([fixture.root]);
    const panel = vscodeMock.window.createWebviewPanel('test', 'test');
    const id = projectId(fixture.root);

    await handleAuditMessage(panel as any, {
      tab: 'audit',
      type: 'runAudit',
      projectIds: [id],
      contentPaths: [],
      duplicateThreshold: 50,
    });

    const completeCall = (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      ([msg]: [any]) => msg?.type === 'auditComplete',
    );
    expect(completeCall).toBeDefined();

    const [message] = completeCall!;
    expect(message.tab).toBe('audit');
    expect(message.type).toBe('auditComplete');
    expect(message.result.summary.totalComponents).toBe(1);
    expect(message.result.summary.withSlingModel).toBe(1);
    expect(message.result.summary.withDialog).toBe(1);
  });
});
