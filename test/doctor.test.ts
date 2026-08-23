import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/core/doctor';
import { doctorReportToSarif } from '../src/core/sarif';
import { createAemCloudFixture, createAmsFixture, type AemFixture, write } from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

describe('AEM Cloud Doctor', () => {
  it('passes a complete fixture and exports SARIF', () => {
    fixture = createAemCloudFixture();
    const report = runDoctor(fixture.root);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.passed).toBe(true);
    expect(report.summary.averageQualityScore).toBe(100);
    const sarif = doctorReportToSarif(report);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
  });

  it('accepts the current archetype dispatcher module name', () => {
    fixture = createAemCloudFixture();
    fs.renameSync(path.join(fixture.root, 'dispatcher.cloud'), path.join(fixture.root, 'dispatcher'));
    const pomFile = path.join(fixture.root, 'pom.xml');
    fs.writeFileSync(
      pomFile,
      fs.readFileSync(pomFile, 'utf-8').replace('dispatcher.cloud', 'dispatcher'),
      'utf-8',
    );
    expect(runDoctor(fixture.root).summary.passed).toBe(true);
  });

  it('applies strict organization policy to missing metadata', () => {
    fixture = createAemCloudFixture();
    const component =
      'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/plain/.content.xml';
    write(
      fixture.root,
      component,
      '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:Component" jcr:title="Plain" componentGroup="Sample Site - Content"/>',
    );
    fs.writeFileSync(
      path.join(fixture.root, '.aem-catalog-policy.json'),
      JSON.stringify({ schemaVersion: 1, extends: ['strict-aemaacs'], minimumQualityScore: 90 }),
    );
    const report = runDoctor(fixture.root);
    expect(report.summary.passed).toBe(false);
    expect(
      report.findings.some(
        (finding) => finding.ruleId === 'component.require-owner' && finding.severity === 'error',
      ),
    ).toBe(true);
    expect(report.findings.some((finding) => finding.ruleId === 'component.minimum-quality')).toBe(true);
  });

  it('detects mutable content in ui.apps', () => {
    fixture = createAemCloudFixture();
    fs.writeFileSync(
      path.join(fixture.root, 'ui.apps/src/main/content/META-INF/vault/filter.xml'),
      '<workspaceFilter version="1.0"><filter root="/content/sample-site"/></workspaceFilter>',
    );
    const report = runDoctor(fixture.root);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ ruleId: 'aemaacs.package-separation', severity: 'error' }),
    );
  });

  it('flags the catalog\'s own RepoInit file when publish-only, by exact name (not a "component" substring guess)', () => {
    // appId deliberately does NOT contain the word "component" — regression guard for the
    // old, fragile `file.includes('component')` heuristic that only worked by coincidence
    // for appIds like "pidilite-component-library".
    fixture = createAemCloudFixture();
    const publishDir = path.join(
      fixture.root,
      'ui.config/src/main/content/jcr_root/apps/sample-site/osgiconfig/config.publish',
    );
    write(
      fixture.root,
      path.join(
        path.relative(fixture.root, publishDir),
        'org.apache.sling.jcr.repoinit.RepositoryInitializer~sample-site-componentlibrary.cfg.json',
      ),
      JSON.stringify({ scripts: ['create service user sample-site-componentlibrary-service'] }),
    );
    const report = runDoctor(fixture.root);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ ruleId: 'catalog.author-only', severity: 'error' }),
    );
  });

  it('does not false-positive on an unrelated publish-scoped RepoInit file that is not the catalog\'s own', () => {
    fixture = createAemCloudFixture();
    const publishDir = path.join(
      fixture.root,
      'ui.config/src/main/content/jcr_root/apps/sample-site/osgiconfig/config.publish',
    );
    write(
      fixture.root,
      path.join(
        path.relative(fixture.root, publishDir),
        'org.apache.sling.jcr.repoinit.RepositoryInitializer~sample-site.cfg.json',
      ),
      JSON.stringify({ scripts: ['create service user sample-site-service'] }),
    );
    const report = runDoctor(fixture.root);
    expect(report.findings.some((finding) => finding.ruleId === 'catalog.author-only')).toBe(false);
  });

  it('passes an AEM AMS reactor the same way it passes an AEMaaCS one', () => {
    fixture = createAmsFixture();
    const report = runDoctor(fixture.root);
    expect(report.project?.platform).toBe('ams');
    expect(report.summary.errors).toBe(0);
    expect(report.summary.passed).toBe(true);
    expect(report.findings.some((finding) => finding.ruleId === 'aemaacs.project')).toBe(false);
  });
});
