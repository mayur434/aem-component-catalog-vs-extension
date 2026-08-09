import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/loader';
import { scanComponents } from '../src/scanner/componentScanner';
import { parseAemCloudProject } from '../src/scanner/projectDetector';
import { createAemCloudFixture, type AemFixture } from './helpers/fixture';

let fixture: AemFixture | undefined;
let legacyRoot: string | undefined;
afterEach(() => {
  fixture?.cleanup();
  if (legacyRoot) fs.rmSync(legacyRoot, { recursive: true, force: true });
});

describe('AEMaaCS discovery and component scanning', () => {
  it('accepts a Cloud reactor and discovers the Java package', () => {
    fixture = createAemCloudFixture();
    const project = parseAemCloudProject(fixture.root);
    expect(project?.platform).toBe('aemaacs');
    expect(project?.javaPackage).toBe('com.example.core.servlets');
    expect(project?.modules).toContain('ui.config');
  });

  it('rejects a legacy uber-jar reactor', () => {
    legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aem-legacy-test-'));
    fs.writeFileSync(
      path.join(legacyRoot, 'pom.xml'),
      '<project><artifactId>legacy</artifactId><packaging>pom</packaging><dependencies><dependency><artifactId>uber-jar</artifactId></dependency></dependencies><modules><module>core</module></modules></project>',
    );
    expect(parseAemCloudProject(legacyRoot)).toBeNull();
  });

  it('recursively scans enterprise metadata and calculates quality', () => {
    fixture = createAemCloudFixture();
    const result = scanComponents(fixture.root, loadConfig(fixture.root));
    expect(result.total).toBe(1);
    expect(result.averageQualityScore).toBe(100);
    expect(result.components[0]).toMatchObject({
      resourceType: 'sample-site/components/content/button',
      owner: 'design-system',
      status: 'active',
      version: '2.1.0',
      modelClass: 'com.example.core.models.Sample',
      exporter: true,
      quality: { score: 100, grade: 'A' },
    });
    expect(result.components[0].tags).toEqual(['action', 'core']);
    expect(result.components[0].dialogFields).toContainEqual(
      expect.objectContaining({ name: './title', label: 'Title', required: true }),
    );
  });
});
