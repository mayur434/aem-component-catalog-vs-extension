import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/core/doctor';
import { doctorReportToSarif } from '../src/core/sarif';
import { createAemCloudFixture, type AemFixture, write } from './helpers/fixture';

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
});
