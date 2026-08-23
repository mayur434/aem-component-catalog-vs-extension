import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from '../src/config/loader';
import { applySelections, currentSelections } from '../src/webview/panelSelections';
import { createAemCloudFixture, type AemFixture } from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

describe('config-panel selections merge (not clobber) the existing config', () => {
  it('preserves fields the panel does not expose across a Generate click', () => {
    fixture = createAemCloudFixture();
    const project = { artifactId: 'sample-site', root: fixture.root, javaPackage: 'com.example.core' };

    // Simulate settings that only exist because someone (a person, or a different tool)
    // set them directly - none of these are controlled by the visual panel.
    const before = loadConfig(fixture.root);
    before.catalog.requirePublishedUsage = true;
    before.catalog.usageIndexName = 'smpl.componentUsage-custom-7';
    before.taxonomy.categoryLabels = { haisha: 'Haisha Paints' };
    before.governance.ownerProperty = 'customOwnerProp';
    saveConfig(fixture.root, before);

    // A real "Generate" click only ever sends these panel-controlled fields.
    const message = {
      brandName: 'Acme',
      primary: '#112233',
      accent: '#445566',
      background: '#ffffff',
      title: 'Acme Catalog',
      description: 'Acme components',
      subCategoryProperty: 'catalogSubCategory',
      features: { search: true, groupFilters: false },
    };

    const after = applySelections(project, message);

    // The bug: applySelections used to call getDefaults() fresh, silently discarding all
    // of this - which is exactly what happened in production (requirePublishedUsage and
    // the Oak index name vanished after a Generate click from a config-panel build that
    // still had this bug).
    expect(after.catalog.requirePublishedUsage).toBe(true);
    expect(after.catalog.usageIndexName).toBe('smpl.componentUsage-custom-7');
    expect(after.taxonomy.categoryLabels).toEqual({ haisha: 'Haisha Paints' });
    expect(after.governance.ownerProperty).toBe('customOwnerProp');

    // The panel-controlled fields must still apply correctly.
    expect(after.hero.titlePrefix).toBe('Acme');
    expect(after.output.pageTitle).toBe('Acme Catalog');
    expect(after.brand.primary).toBe('#112233');
    expect(after.features.search).toBe(true);
    expect(after.features.groupFilters).toBe(false);
    expect(after.output.servletPackage).toBe('com.example.core');
  });

  it('falls back to fresh defaults for a project with no saved config yet', () => {
    fixture = createAemCloudFixture();
    // createAemCloudFixture() seeds a config as part of setup; delete it to genuinely
    // simulate a brand-new, never-configured project.
    fs.unlinkSync(path.join(fixture.root, '.component-library.json'));
    const project = { artifactId: 'brand-new-site', root: fixture.root, javaPackage: 'com.example.core' };
    const message = { brandName: '', primary: '', accent: '', background: '', title: '', description: '', subCategoryProperty: '', features: {} };
    const after = applySelections(project, message);
    expect(after.catalog.requirePublishedUsage).toBe(false);
    expect(after.hero.titlePrefix).toBe('Brand'); // prettyBrand('brand-new-site')
  });

  it('currentSelections reads from the same merged source applySelections writes to', () => {
    fixture = createAemCloudFixture();
    const before = loadConfig(fixture.root);
    before.brand.primary = '#abcdef';
    before.output.pageTitle = 'Existing Title';
    saveConfig(fixture.root, before);

    const selections = currentSelections({ root: fixture.root, artifactId: 'sample-site' });
    expect(selections.primary).toBe('#abcdef');
    expect(selections.title).toBe('Existing Title');
  });

  it('round-trips taxonomy.siteDomains through the panel like categoryLabels', () => {
    fixture = createAemCloudFixture();
    const project = { artifactId: 'sample-site', root: fixture.root, javaPackage: 'com.example.core' };

    const before = loadConfig(fixture.root);
    before.taxonomy.siteDomains = [
      { category: 'campaign', prodDomain: 'https://www.example.com', stageDomain: '' },
    ];
    saveConfig(fixture.root, before);

    const selections = currentSelections({ root: fixture.root, artifactId: 'sample-site' });
    expect(selections.siteDomains).toEqual([
      { category: 'campaign', prodDomain: 'https://www.example.com', stageDomain: '' },
    ]);

    const message = {
      brandName: 'Acme',
      primary: '#112233',
      accent: '#445566',
      background: '#ffffff',
      title: 'Acme Catalog',
      description: 'Acme components',
      subCategoryProperty: 'catalogSubCategory',
      features: {},
      siteDomains: [
        { category: 'campaign', prodDomain: 'https://www.example.com', stageDomain: 'https://stage.example.com', shortenPath: '/content/campaign' },
        { category: 'corporate', prodDomain: '', stageDomain: '' },
      ],
    };
    const after = applySelections(project, message);
    expect(after.taxonomy.siteDomains).toEqual([
      { category: 'campaign', prodDomain: 'https://www.example.com', stageDomain: 'https://stage.example.com', shortenPath: '/content/campaign' },
      { category: 'corporate', prodDomain: '', stageDomain: '', shortenPath: '' },
    ]);
  });

  it('pre-seeds one site-domain row per known category when none is saved yet', () => {
    fixture = createAemCloudFixture();
    const before = loadConfig(fixture.root);
    before.taxonomy.categoryLabels = { haisha: 'Haisha Paints', corporate: 'Corporate' };
    saveConfig(fixture.root, before);

    const selections = currentSelections({ root: fixture.root, artifactId: 'sample-site' });
    expect(selections.siteDomains).toEqual([
      { category: 'haisha', prodDomain: '', stageDomain: '', shortenPath: '' },
      { category: 'corporate', prodDomain: '', stageDomain: '', shortenPath: '' },
    ]);
  });

  it('sanitizes site-domain rows: drops unsafe/duplicate categories, blanks malformed domains and paths', () => {
    fixture = createAemCloudFixture();
    const project = { artifactId: 'sample-site', root: fixture.root, javaPackage: 'com.example.core' };
    const message = {
      brandName: '',
      primary: '',
      accent: '',
      background: '',
      title: '',
      description: '',
      subCategoryProperty: '',
      features: {},
      siteDomains: [
        { category: 'campaign', prodDomain: 'not-a-url', stageDomain: 'https://stage.example.com', shortenPath: 'content/campaign' },
        { category: 'bad category!', prodDomain: 'https://x.example.com', stageDomain: '' },
        { category: 'campaign', prodDomain: '', stageDomain: '' }, // duplicate category, dropped
      ],
    };
    const after = applySelections(project, message);
    expect(after.taxonomy.siteDomains).toEqual([
      // Missing leading "/" makes shortenPath malformed, so it's blanked - same treatment as
      // "not-a-url" for prodDomain - not a dropped row.
      { category: 'campaign', prodDomain: '', stageDomain: 'https://stage.example.com', shortenPath: '' },
    ]);
  });
});
