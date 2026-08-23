import { describe, expect, it, afterEach } from 'vitest';
import { loadConfig, saveConfig } from '../src/config/loader';
import { buildGenerationPlan } from '../src/core/generation';
import { planSiteDomainOsgiConfigs } from '../src/generators/osgiConfigGenerator';
import { planSiteDomainService } from '../src/generators/siteDomainServiceGenerator';
import { resolveAemPaths } from '../src/utils/aemPaths';
import { createAemCloudFixture, type AemFixture } from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

describe('SiteDomainService run-mode OSGi config generation', () => {
  it('produces no site-domain artifacts at all when taxonomy.siteDomains is empty', () => {
    fixture = createAemCloudFixture();
    const config = loadConfig(fixture.root);
    expect(config.taxonomy.siteDomains).toEqual([]);

    const paths = resolveAemPaths(fixture.root);
    expect(planSiteDomainOsgiConfigs(config, paths)).toEqual([]);
    expect(planSiteDomainService(config, paths)).toEqual([]);

    // Confirms it stays absent end-to-end through the aggregated plan too.
    const plan = buildGenerationPlan(fixture.root, config);
    expect(plan.items.some((item) => item.relativePath.includes('SiteDomainService'))).toBe(false);
  });

  it('produces exactly config.prod + config.stage artifacts, correctly formatted, when configured', () => {
    fixture = createAemCloudFixture();
    const config = loadConfig(fixture.root);
    config.taxonomy.siteDomains = [
      { category: 'campaign', prodDomain: 'https://example.com', stageDomain: '', shortenPath: '/content/campaign' },
      { category: 'corporate', prodDomain: '', stageDomain: 'https://stage.corporate.example.com', shortenPath: '' },
    ];
    saveConfig(fixture.root, config);

    const paths = resolveAemPaths(fixture.root);
    const artifacts = planSiteDomainOsgiConfigs(config, paths);
    expect(artifacts).toHaveLength(2);

    const expectedFileName = 'com.example.core.servlets.SiteDomainService.cfg.json';
    const prod = artifacts.find((item) => item.absolutePath.includes('osgiconfig/config.prod'))!;
    const stage = artifacts.find((item) => item.absolutePath.includes('osgiconfig/config.stage'))!;
    expect(prod).toBeDefined();
    expect(stage).toBeDefined();
    expect(prod.absolutePath.endsWith(expectedFileName)).toBe(true);
    expect(stage.absolutePath.endsWith(expectedFileName)).toBe(true);
    // Never nested under config.author - siblings of config/config.author.
    expect(prod.absolutePath).not.toContain('config.author');
    expect(stage.absolutePath).not.toContain('config.author');
    expect(prod.kind).toBe('osgi');
    expect(stage.kind).toBe('osgi');

    const prodJson = JSON.parse(prod.content) as { siteDomains: string[] };
    expect(prodJson.siteDomains).toEqual([
      'campaign=https://example.com=/content/campaign',
      // Blank-domain fallback format: "<category>==" with nothing after either "=".
      'corporate==',
    ]);

    const stageJson = JSON.parse(stage.content) as { siteDomains: string[] };
    expect(stageJson.siteDomains).toEqual([
      // shortenPath is a fixed per-site property, so it's written the same into stage too.
      'campaign==/content/campaign',
      'corporate=https://stage.corporate.example.com=',
    ]);

    // The Java class itself is only generated alongside the config, in the same package.
    const javaArtifacts = planSiteDomainService(config, paths);
    expect(javaArtifacts).toHaveLength(1);
    expect(javaArtifacts[0].absolutePath.endsWith('SiteDomainService.java')).toBe(true);
    expect(javaArtifacts[0].content).toContain('package com.example.core.servlets;');
    // Annotation defaults stay always-blank placeholders, never the real domain values.
    expect(javaArtifacts[0].content).toContain('"campaign="');
    expect(javaArtifacts[0].content).toContain('"corporate="');
    expect(javaArtifacts[0].content).not.toContain('https://example.com');

    // ComponentUsageService picks up the @Reference + url wiring once siteDomains is non-empty.
    const plan = buildGenerationPlan(fixture.root, config);
    const usageService = plan.items.find((item) => item.relativePath.endsWith('ComponentUsageService.java'))!
      .content;
    expect(usageService).toContain('private transient SiteDomainService siteDomainService;');
    expect(usageService).toContain('siteDomainService.resolveUrl(page.getPath())');
  });
});
