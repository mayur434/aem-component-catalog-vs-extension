import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli';
import { createSupportBundle } from '../src/core/supportBundle';
import { getTemplateRegistry } from '../src/core/templateRegistry';
import { createAemCloudFixture, type AemFixture } from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

describe('CLI and supportability', () => {
  it('initializes configuration and policy non-interactively', () => {
    fixture = createAemCloudFixture();
    fs.unlinkSync(path.join(fixture.root, '.component-library.json'));
    expect(main(['init', '--project', fixture.root])).toBe(2);
    expect(main(['init', '--project', fixture.root, '--yes'])).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(fixture.root, '.component-library.json'), 'utf-8')),
    ).toMatchObject({
      schemaVersion: 2,
      appId: 'sample-site',
      output: { servletPackage: 'com.example.core.servlets' },
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(fixture.root, '.aem-catalog-policy.json'), 'utf-8')),
    ).toMatchObject({
      schemaVersion: 1,
      extends: ['recommended-aemaacs'],
    });
  });

  it('exports SARIF and CSV through the headless CLI', () => {
    fixture = createAemCloudFixture();
    const sarifFile = path.join(fixture.root, 'doctor.sarif');
    const csvFile = path.join(fixture.root, 'components.csv');
    expect(main(['doctor', '--project', fixture.root, '--format', 'sarif', '--output', sarifFile])).toBe(0);
    expect(JSON.parse(fs.readFileSync(sarifFile, 'utf-8')).version).toBe('2.1.0');
    expect(main(['scan', '--project', fixture.root, '--format', 'csv', '--output', csvFile])).toBe(0);
    expect(fs.readFileSync(csvFile, 'utf-8')).toContain('sample-site/components/content/button');
  });

  it('creates a redacted support bundle and a deterministic template registry', () => {
    fixture = createAemCloudFixture();
    const first = getTemplateRegistry();
    const second = getTemplateRegistry();
    expect(first.digest).toBe(second.digest);
    expect(first.entries.length).toBeGreaterThan(5);
    const bundle = createSupportBundle(fixture.root);
    expect(bundle.doctor.projectRoot).toBe('<project-root>');
    expect(bundle.doctor.project?.root).toBe('<project-root>');
    expect(JSON.stringify(bundle)).not.toContain(fixture.root);
  });
});
