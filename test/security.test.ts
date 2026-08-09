import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

describe('extension security boundaries', () => {
  it('uses a strict CSP and hashed project identifiers in the unified Catalog panel', () => {
    const catalogPanel = fs.readFileSync(path.join(process.cwd(), 'src/webview/catalogPanel.ts'), 'utf-8');
    const overview = fs.readFileSync(path.join(process.cwd(), 'src/webview/catalogTabs/overviewTab.ts'), 'utf-8');
    const configure = fs.readFileSync(path.join(process.cwd(), 'src/webview/catalogTabs/configureTab.ts'), 'utf-8');
    const audit = fs.readFileSync(path.join(process.cwd(), 'src/webview/catalogTabs/auditTab.ts'), 'utf-8');

    // No `<script src>`/`<link>` resources are loaded from disk — everything is
    // inlined into the document, so there is no localResourceRoots surface at all.
    expect(catalogPanel).toContain("default-src 'none'");
    expect(catalogPanel).not.toContain('asWebviewUri');

    // Client-side code must only ever reference the hashed projectId, never a raw
    // filesystem path, in a message payload.
    for (const [name, source] of [['overview', overview], ['configure', configure], ['audit', audit]] as const) {
      expect(source, `${name} tab must not put a raw project root in a message payload`).not.toMatch(
        /postMessage\([^)]*projectRoot/,
      );
    }

    // The tab that performs a full-fragment innerHTML swap (Overview's refresh)
    // must render its dynamic, filesystem-derived strings through escapeHtml.
    expect(overview).toContain("from '../../utils/webviewHelpers'");
    expect(overview).toContain('escapeHtml(');
  });

  it('declares Workspace Trust and disables virtual workspaces', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as {
      capabilities: { untrustedWorkspaces: { supported: string }; virtualWorkspaces: boolean };
    };
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe('limited');
    expect(manifest.capabilities.virtualWorkspaces).toBe(false);
  });
});
