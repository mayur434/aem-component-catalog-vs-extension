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

  it('derives every identity-bearing default from the given appId, with no vendor coupling', () => {
    const acme = getDefaults('acme-widgets');
    const globex = getDefaults('globex-storefront');

    expect(acme.components.root).toBe('/apps/acme-widgets/components');
    expect(acme.output.servletPackage).toBe('com.acme.widgets.core.servlets');
    expect(acme.output.clientlibCategory).toBe('acme-widgets.componentlibrary');
    expect(acme.output.contentPath).toBe('/content/acme-widgets/component-library');
    expect(acme.output.assetRoot).toBe('/content/dam/acme-widgets/catalog');
    expect(acme.serviceUser.name).toBe('acme-widgets-componentlibrary-service');
    expect(acme.serviceUser.bundleSymbolicName).toBe('acme-widgets.core');
    expect(acme.hero.badge).toBe('acme-widgets');
    expect(acme.catalog.usageIndexName).toMatch(/^acm\.componentUsage-custom-1$/);

    // Two different projects never share a brand-identifying default.
    expect(acme.output.servletPackage).not.toBe(globex.output.servletPackage);
    expect(acme.hero.badge).not.toBe(globex.hero.badge);
  });

  it('never hardcodes any specific customer/brand name anywhere in the extension source', () => {
    const srcRoot = path.join(__dirname, '..', 'src');
    const bannedTerms = ['pidilite', 'haisha'];
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|json)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf-8').toLowerCase();
          for (const term of bannedTerms) {
            if (content.includes(term)) offenders.push(`${full} contains "${term}"`);
          }
        }
      }
    };
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
