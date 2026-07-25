import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli';
import { createAemCloudFixture, write, type AemFixture } from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

function run(fixtureRoot: string, argv: string[]): { code: number; output: string } {
  const outFile = path.join(fixtureRoot, `.cli-out-${Math.abs(argv.join('.').length)}.txt`);
  const code = main([...argv, '--project', fixtureRoot, '--output', outFile]);
  const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf-8') : '';
  return { code, output };
}

describe('enterprise CLI: preflight, remediate, headless generate', () => {
  it('reports preflight readiness and exits non-zero when blocked', () => {
    fixture = createAemCloudFixture();
    const healthy = run(fixture.root, ['preflight', '--format', 'json']);
    expect(healthy.code).toBe(0);
    expect(JSON.parse(healthy.output).summary.passed).toBe(true);

    fs.rmSync(path.join(fixture.root, '.component-library.json'));
    const blocked = run(fixture.root, ['preflight', '--format', 'json']);
    expect(blocked.code).toBe(1);
    expect(JSON.parse(blocked.output).checks.some((c: { remediationId?: string }) => c.remediationId === 'create-config')).toBe(true);
  });

  it('lists remediations, previews as a dry run, and applies with --yes', () => {
    fixture = createAemCloudFixture();
    write(
      fixture.root,
      'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/bare/.content.xml',
      '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:Component" jcr:title="Bare" componentGroup="Sample Site - Content"/>',
    );
    expect(run(fixture.root, ['remediate']).output).toContain('scaffold-governance-metadata');

    const dry = run(fixture.root, ['remediate', 'scaffold-governance-metadata']);
    expect(dry.code).toBe(1); // pending changes → non-zero for CI gating
    expect(dry.output).toContain('/bare/');
    expect(fs.readFileSync(path.join(fixture.root, 'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/bare/.content.xml'), 'utf-8')).not.toContain('catalogOwner');

    const applied = run(fixture.root, ['remediate', 'scaffold-governance-metadata', '--yes']);
    expect(applied.code).toBe(0);
    expect(fs.readFileSync(path.join(fixture.root, 'ui.apps/src/main/content/jcr_root/apps/sample-site/components/content/bare/.content.xml'), 'utf-8')).toContain('catalogOwner="Unassigned"');
  });

  it('generates headlessly through the preflight + doctor gate and is idempotent', () => {
    fixture = createAemCloudFixture();
    expect(main(['generate', '--project', fixture.root, '--yes'])).toBe(0);
    expect(fs.existsSync(path.join(fixture.root, '.aem-catalog-manifest.json'))).toBe(true);
    // Lock is released after a successful run.
    expect(fs.existsSync(path.join(fixture.root, '.aem-catalog', 'generation.lock'))).toBe(false);
    // Second run finds nothing to do.
    expect(main(['generate', '--project', fixture.root, '--yes'])).toBe(0);
  });
});
