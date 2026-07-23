import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaults } from '../src/config/defaults';
import { loadConfig, migrateConfig, validateConfig } from '../src/config/loader';
import { createAemCloudFixture, type AemFixture } from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

describe('configuration', () => {
  it('migrates an unversioned v1 configuration', () => {
    const migrated = migrateConfig({
      appId: 'sample-site',
      projectType: 'ams',
      features: { groupFilter: false },
      serviceUser: { systemUser: 'sample-service' },
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.projectType).toBeUndefined();
    expect(migrated.features.groupFilters).toBe(false);
    expect(migrated.serviceUser.name).toBe('sample-service');
  });

  it('loads defaults and validates a migrated file', () => {
    fixture = createAemCloudFixture();
    const file = path.join(fixture.root, '.component-library.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    delete raw.schemaVersion;
    fs.writeFileSync(file, JSON.stringify(raw), 'utf-8');
    const config = loadConfig(fixture.root);
    expect(config.schemaVersion).toBe(2);
    expect(validateConfig(config)).toEqual([]);
  });

  it('rejects unsafe paths, CSS, and non-author deployment', () => {
    const config = getDefaults('sample-site');
    config.output.contentPath = '/content/../escape';
    config.brand.fontFallback = 'Arial; background:url(x)';
    (config.catalog as { deploymentTarget: string }).deploymentTarget = 'publish';
    const errors = validateConfig(config).join('\n');
    expect(errors).toContain('unsafe path');
    expect(errors).toContain('unsafe CSS');
    expect(errors).toContain('must be "author"');
  });
});
