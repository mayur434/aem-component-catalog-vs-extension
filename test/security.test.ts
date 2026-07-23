import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

describe('extension security boundaries', () => {
  it('uses strict CSP and project identifiers in the dashboard', () => {
    const dashboard = fs.readFileSync(path.join(process.cwd(), 'src/webview/dashboard.ts'), 'utf-8');
    const client = fs.readFileSync(path.join(process.cwd(), 'resources/dashboard.js'), 'utf-8');
    expect(dashboard).toContain("default-src 'none'");
    expect(dashboard).toContain('localResourceRoots: [resources]');
    expect(dashboard).not.toContain('message.projectRoot');
    expect(client).toContain('projectId');
    expect(client).not.toContain('innerHTML');
  });

  it('declares Workspace Trust and disables virtual workspaces', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as {
      capabilities: { untrustedWorkspaces: { supported: string }; virtualWorkspaces: boolean };
    };
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe('limited');
    expect(manifest.capabilities.virtualWorkspaces).toBe(false);
  });
});
