import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/loader';
import { checkGenerationPrerequisites, runPreflight } from '../src/core/preflight';
import {
  applyRemediationActions,
  injectAttributes,
  planRemediation,
  remediationsForRule,
} from '../src/core/remediation';
import { acquireLock, clearStaleLock, isLockStale, readLock } from '../src/utils/lock';
import {
  createAemCloudFixture,
  createAmsAlternateNamingFixture,
  createAmsFixture,
  write,
  type AemFixture,
} from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

describe('generation preflight', () => {
  it('passes on a healthy project and reports component metadata coverage', () => {
    fixture = createAemCloudFixture();
    const report = runPreflight(fixture.root, { config: loadConfig(fixture.root), trusted: true });
    expect(report.summary.passed).toBe(true);
    expect(report.checks.find((c) => c.id === 'workspace-trust')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'components-present')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'generation-plan')?.status).toBe('pass');
  });

  it('fails closed on missing config and untrusted workspace, and names the remediation', () => {
    fixture = createAemCloudFixture();
    fs.rmSync(path.join(fixture.root, '.component-library.json'));
    const report = runPreflight(fixture.root, { trusted: false });
    expect(report.summary.passed).toBe(false);
    expect(report.checks.find((c) => c.id === 'workspace-trust')?.status).toBe('fail');
    const config = report.checks.find((c) => c.id === 'catalog-config');
    expect(config?.status).toBe('fail');
    expect(config?.remediationId).toBe('create-config');
  });

  it('warns when a component lacks governance metadata', () => {
    fixture = createAemCloudFixture();
    write(
      fixture.root,
      'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/bare/.content.xml',
      '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:Component" jcr:title="Bare" componentGroup="Sample Site - Content"/>',
    );
    const report = runPreflight(fixture.root, { config: loadConfig(fixture.root) });
    const governance = report.checks.find((c) => c.id === 'governance-metadata');
    expect(governance?.status).toBe('warn');
    expect(governance?.remediationId).toBe('scaffold-governance-metadata');
  });

  it('passes an AEM AMS reactor the same way it passes an AEMaaCS one', () => {
    fixture = createAmsFixture();
    const report = runPreflight(fixture.root, { config: loadConfig(fixture.root), trusted: true });
    expect(report.summary.passed).toBe(true);
    expect(report.checks.find((c) => c.id === 'platform-detected')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'platform-detected')?.title).toContain('AEM AMS');
    expect(report.checks.find((c) => c.id === 'ui-config-present')?.status).toBe('pass');
  });
});

describe('checkGenerationPrerequisites', () => {
  it('accepts both AEMaaCS and AEM AMS reactors that have ui.config', () => {
    const cloud = createAemCloudFixture();
    const ams = createAmsFixture();
    try {
      expect(checkGenerationPrerequisites(cloud.root)).toMatchObject({ ok: true, platform: 'aemaacs', failures: [] });
      expect(checkGenerationPrerequisites(ams.root)).toMatchObject({ ok: true, platform: 'ams', failures: [] });
    } finally {
      cloud.cleanup();
      ams.cleanup();
    }
  });

  it('fails closed when ui.config is missing, even on an otherwise-valid reactor', () => {
    fixture = createAemCloudFixture();
    fs.rmSync(path.join(fixture.root, 'ui.config'), { recursive: true, force: true });
    const result = checkGenerationPrerequisites(fixture.root);
    expect(result.ok).toBe(false);
    expect(result.failures.some((message) => message.includes('ui.config'))).toBe(true);
  });

  it('fails closed when no supported AEM reactor is detected', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aem-none-test-'));
    try {
      const result = checkGenerationPrerequisites(empty);
      expect(result.ok).toBe(false);
      expect(result.platform).toBeNull();
      expect(result.failures.some((message) => message.includes('No supported AEM reactor'))).toBe(true);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('accepts an AEM AMS reactor using the alternate bundle/content module naming', () => {
    fixture = createAmsAlternateNamingFixture();
    const result = checkGenerationPrerequisites(fixture.root);
    expect(result).toMatchObject({ ok: true, platform: 'ams', failures: [] });
  });
});

describe('detect-and-guide remediation', () => {
  it('seeds only the missing governance properties, XML-escaped, without touching existing ones', () => {
    fixture = createAemCloudFixture();
    write(
      fixture.root,
      'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/bare/.content.xml',
      '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:Component" jcr:title="Bare" catalogStatus="active" componentGroup="Sample Site - Content"/>',
    );
    const actions = planRemediation('scaffold-governance-metadata', fixture.root, loadConfig(fixture.root));
    const bare = actions.find((a) => a.relativePath.includes('/bare/'))!;
    expect(bare.content).toContain('catalogOwner="Unassigned"');
    expect(bare.content).toContain('catalogVersion="1.0"');
    // Existing status is preserved (added exactly once).
    expect(bare.content.match(/catalogStatus=/g)).toHaveLength(1);
    // The pre-configured button already has full metadata → no action for it.
    expect(actions.some((a) => a.relativePath.includes('/button/'))).toBe(false);

    const result = applyRemediationActions(fixture.root, [bare], 'test');
    expect(result.backupDir).toBeTruthy();
    expect(fs.readFileSync(bare.absolutePath, 'utf-8')).toContain('catalogOwner="Unassigned"');
  });

  it('maps rule ids to remediations and escapes ampersands in injected values', () => {
    expect(remediationsForRule('component.require-owner').map((r) => r.id)).toContain('scaffold-governance-metadata');
    const xml = '<jcr:root jcr:primaryType="cq:Component" jcr:title="X"/>';
    const out = injectAttributes(xml, { catalogOwner: 'R&D <team>' })!;
    expect(out).toContain('catalogOwner="R&amp;D &lt;team&gt;"');
    // Non-component nodes and already-present props are left untouched.
    expect(injectAttributes('<jcr:root jcr:primaryType="nt:unstructured"/>', { catalogOwner: 'x' })).toBeNull();
    expect(injectAttributes('<jcr:root jcr:primaryType="cq:Component" catalogOwner="set"/>', { catalogOwner: 'x' })).toBeNull();
  });
});

describe('generation lock', () => {
  it('grants a lock, blocks a foreign live lock, and reclaims a stale one', () => {
    fixture = createAemCloudFixture();
    const release = acquireLock(fixture.root, 'test');
    expect(readLock(fixture.root)?.pid).toBe(process.pid);

    // A foreign, live lock blocks acquisition.
    const foreign = { pid: process.pid, actor: 'other', hostname: readLock(fixture.root)!.hostname, createdAt: new Date().toISOString() };
    const stale = { ...foreign, createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
    expect(isLockStale(stale)).toBe(true);
    expect(isLockStale(foreign)).toBe(false);

    release();
    expect(readLock(fixture.root)).toBeNull();

    // A stale lock on disk is cleared and re-acquired.
    fs.writeFileSync(
      path.join(fixture.root, '.aem-catalog', 'generation.lock'),
      JSON.stringify({ pid: 999999, actor: 'ghost', hostname: 'nowhere', createdAt: new Date(Date.now() - 3600_000).toISOString() }),
    );
    expect(clearStaleLock(fixture.root)).toBe(true);
    expect(readLock(fixture.root)).toBeNull();
  });
});
