import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from '../src/audit/auditEngine';
import { buildSuperTypeChain, resolveClassification, isOotbResourceType } from '../src/audit/componentClassifier';
import { detectDuplicates, hashComponentFiles } from '../src/audit/duplicateDetector';
import { parseContentPackages } from '../src/audit/contentPackageParser';
import { generateExcelReport } from '../src/audit/excelReporter';
import { detectAllProjects, parseAemCloudProject, parseAmsProject } from '../src/scanner/projectDetector';
import type { AuditComponent } from '../src/audit/types';

let tempDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aem-audit-test-'));
  tempDirs.push(dir);
  return dir;
}

function write(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function createAemCloudFixture(): string {
  const root = tmpDir();
  write(root, 'pom.xml', `<project>
    <groupId>com.example</groupId><artifactId>cloud-site</artifactId><version>1.0.0</version><packaging>pom</packaging>
    <dependencyManagement><dependencies><dependency><groupId>com.adobe.aem</groupId><artifactId>aem-sdk-api</artifactId><version>2026.7.0</version></dependency></dependencies></dependencyManagement>
    <modules><module>core</module><module>ui.apps</module><module>ui.config</module><module>all</module><module>dispatcher.cloud</module></modules>
  </project>`);
  for (const m of ['core', 'ui.apps', 'ui.config', 'all', 'dispatcher.cloud']) {
    fs.mkdirSync(path.join(root, m), { recursive: true });
    write(root, `${m}/pom.xml`, `<project><artifactId>cloud-site.${m}</artifactId><packaging>content-package</packaging></project>`);
  }
  addComponent(root, 'mysite', 'button', {
    title: 'Button',
    group: 'MySite - Content',
    superType: 'core/wcm/components/button/v2/button',
  });
  addComponent(root, 'mysite', 'hero', {
    title: 'Hero Banner',
    group: 'MySite - Content',
    superType: '',
    dialog: true,
    htl: true,
  });
  addComponent(root, 'mysite', 'teaser', {
    title: 'Teaser',
    group: 'MySite - Content',
    superType: 'core/wcm/components/teaser/v2/teaser',
    dialog: true,
    htl: true,
  });
  write(root, 'core/src/main/java/com/example/models/TeaserModel.java',
    `package com.example.models;
import org.apache.sling.models.annotations.Model;
@Model(adaptables = org.apache.sling.api.resource.Resource.class, resourceType = "mysite/components/teaser")
public class TeaserModel {}
`);
  return root;
}

function createAmsFixture(): string {
  const root = tmpDir();
  write(root, 'pom.xml', `<project>
    <groupId>com.legacy</groupId><artifactId>ams-site</artifactId><version>2.0.0</version><packaging>pom</packaging>
    <dependencyManagement><dependencies><dependency><groupId>com.adobe.aem</groupId><artifactId>uber-jar</artifactId><version>6.5.21</version></dependency></dependencies></dependencyManagement>
    <modules><module>core</module><module>ui.apps</module><module>ui.content</module></modules>
  </project>`);
  for (const m of ['core', 'ui.apps', 'ui.content']) {
    fs.mkdirSync(path.join(root, m), { recursive: true });
    write(root, `${m}/pom.xml`, `<project><artifactId>ams-site.${m}</artifactId><packaging>content-package</packaging></project>`);
  }
  addComponent(root, 'legacysite', 'carousel', {
    title: 'Carousel',
    group: 'Legacy - Content',
    superType: '',
    htl: true,
  });
  return root;
}

function addComponent(
  root: string,
  site: string,
  name: string,
  options: { title: string; group: string; superType: string; dialog?: boolean; htl?: boolean },
): void {
  const base = path.join(root, 'ui.apps', 'src', 'main', 'content', 'jcr_root', 'apps', site, 'components', name);
  const superTypeAttr = options.superType ? `sling:resourceSuperType="${options.superType}"` : '';
  write(path.dirname(base), `${name}/.content.xml`, `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    jcr:primaryType="cq:Component" jcr:title="${options.title}" componentGroup="${options.group}" ${superTypeAttr}/>`);
  if (options.dialog) {
    write(base, '_cq_dialog/.content.xml', `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="nt:unstructured">
      <title jcr:primaryType="nt:unstructured" sling:resourceType="granite/ui/components/coral/foundation/form/textfield" name="./title" fieldLabel="Title" required="true"/>
      <text jcr:primaryType="nt:unstructured" sling:resourceType="granite/ui/components/coral/foundation/form/textarea" name="./text" fieldLabel="Text"/>
    </jcr:root>`);
  }
  if (options.htl) {
    write(base, `${name}.html`, `<div data-sly-use.model="com.example.models.${name}">\${model.title}</div>`);
  }
}

describe('project detection', () => {
  it('detects AEMaaCS project', () => {
    const root = createAemCloudFixture();
    const project = parseAemCloudProject(root);
    expect(project).not.toBeNull();
    expect(project!.platform).toBe('aemaacs');
    expect(project!.artifactId).toBe('cloud-site');
  });

  it('detects AMS project', () => {
    const root = createAmsFixture();
    const project = parseAmsProject(root);
    expect(project).not.toBeNull();
    expect(project!.platform).toBe('ams');
    expect(project!.artifactId).toBe('ams-site');
  });

  it('does not detect AMS as AEMaaCS', () => {
    const root = createAmsFixture();
    expect(parseAemCloudProject(root)).toBeNull();
  });

  it('detects multiple projects in workspace folder', () => {
    const workspace = tmpDir();
    const cloud = createAemCloudFixture();
    const ams = createAmsFixture();
    fs.renameSync(cloud, path.join(workspace, 'cloud'));
    fs.renameSync(ams, path.join(workspace, 'ams'));
    tempDirs = tempDirs.filter((d) => d !== cloud && d !== ams);

    const projects = detectAllProjects(workspace);
    expect(projects.length).toBe(2);
    const platforms = projects.map((p) => p.platform).sort();
    expect(platforms).toEqual(['aemaacs', 'ams']);
  });
});

describe('component classifier', () => {
  it('identifies OOTB resource types', () => {
    expect(isOotbResourceType('core/wcm/components/button/v2/button')).toBe(true);
    expect(isOotbResourceType('core/cif/components/product/v1/product')).toBe(true);
    expect(isOotbResourceType('wcm/foundation/components/text')).toBe(true);
    expect(isOotbResourceType('mysite/components/hero')).toBe(false);
  });

  it('builds super type chain', () => {
    const map = new Map<string, string>();
    map.set('mysite/components/button', 'core/wcm/components/button/v2/button');
    map.set('core/wcm/components/button/v2/button', 'core/wcm/components/button/v1/button');

    const chain = buildSuperTypeChain('mysite/components/button', map);
    expect(chain).toEqual([
      'core/wcm/components/button/v2/button',
      'core/wcm/components/button/v1/button',
    ]);
  });

  it('classifies pure proxy correctly', () => {
    const dir = tmpDir();
    write(dir, '.content.xml', '<jcr:root jcr:primaryType="cq:Component"/>');
    const result = resolveClassification(
      'mysite/components/button',
      'core/wcm/components/button/v2/button',
      ['core/wcm/components/button/v2/button'],
      dir,
    );
    expect(result.classification).toBe('proxied');
    expect(result.ootbBase).toBe('core/wcm/components/button/v2/button');
  });

  it('classifies proxied-customized when dialog exists', () => {
    const dir = tmpDir();
    write(dir, '.content.xml', '<jcr:root jcr:primaryType="cq:Component"/>');
    write(dir, '_cq_dialog/.content.xml', '<jcr:root jcr:primaryType="nt:unstructured"/>');
    const result = resolveClassification(
      'mysite/components/button',
      'core/wcm/components/button/v2/button',
      ['core/wcm/components/button/v2/button'],
      dir,
    );
    expect(result.classification).toBe('proxied-customized');
    expect(result.customizations).toContain('custom dialog');
  });

  it('classifies pure custom with no OOTB ancestor', () => {
    const dir = tmpDir();
    const result = resolveClassification('mysite/components/hero', '', [], dir);
    expect(result.classification).toBe('custom');
  });
});

describe('duplicate detector', () => {
  it('detects identical components', () => {
    const dirA = tmpDir();
    const dirB = tmpDir();
    write(dirA, 'button.html', '<div>Button A</div>');
    write(dirA, '.content.xml', '<root/>');
    write(dirB, 'button.html', '<div>Button A</div>');
    write(dirB, '.content.xml', '<root/>');

    const hashA = hashComponentFiles(dirA);
    const hashB = hashComponentFiles(dirB);

    const compA: Partial<AuditComponent> = {
      name: 'button', resourceType: 'siteA/components/button', site: 'siteA', fileHashes: hashA,
    };
    const compB: Partial<AuditComponent> = {
      name: 'button', resourceType: 'siteB/components/button', site: 'siteB', fileHashes: hashB,
    };

    const dupes = detectDuplicates([compA as AuditComponent, compB as AuditComponent], 50);
    expect(dupes.length).toBe(1);
    expect(dupes[0].similarity).toBe(100);
    expect(dupes[0].recommendation).toBe('remove-duplicate');
  });

  it('reports partial similarity', () => {
    const dirA = tmpDir();
    const dirB = tmpDir();
    write(dirA, 'teaser.html', '<div>Teaser A</div>');
    write(dirA, '.content.xml', '<root/>');
    write(dirB, 'teaser.html', '<div>Teaser B - different</div>');
    write(dirB, '.content.xml', '<root/>');

    const hashA = hashComponentFiles(dirA);
    const hashB = hashComponentFiles(dirB);

    const compA: Partial<AuditComponent> = {
      name: 'teaser', resourceType: 'siteA/components/teaser', site: 'siteA', fileHashes: hashA,
    };
    const compB: Partial<AuditComponent> = {
      name: 'teaser', resourceType: 'siteB/components/teaser', site: 'siteB', fileHashes: hashB,
    };

    const dupes = detectDuplicates([compA as AuditComponent, compB as AuditComponent], 50);
    expect(dupes.length).toBe(1);
    expect(dupes[0].similarity).toBe(50);
    expect(dupes[0].matchingFiles).toEqual(['.content.xml']);
    expect(dupes[0].differingFiles).toEqual(['teaser.html']);
  });
});

describe('content package parser', () => {
  it('extracts usage from a content package ZIP', () => {
    const dir = tmpDir();
    const zip = new AdmZip();
    zip.addFile(
      'jcr_root/content/mysite/en/jcr:content/.content.xml',
      Buffer.from(`<jcr:root sling:resourceType="mysite/components/page/homepage" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0">
        <hero sling:resourceType="mysite/components/hero"/>
        <teaser sling:resourceType="mysite/components/teaser"/>
        <teaser2 sling:resourceType="mysite/components/teaser"/>
      </jcr:root>`),
    );
    const zipPath = path.join(dir, 'content.zip');
    zip.writeZip(zipPath);

    const result = parseContentPackages([zipPath]);
    expect(result.usage.get('mysite/components/hero')?.count).toBe(1);
    expect(result.usage.get('mysite/components/teaser')?.count).toBe(2);
    expect(result.usage.get('mysite/components/page/homepage')?.count).toBe(1);
    expect(result.meta.totalPages).toBeGreaterThan(0);
    expect(result.meta.sitePageCounts['mysite']).toBeGreaterThan(0);
  });

  it('handles folder of ZIPs', () => {
    const dir = tmpDir();
    const zip = new AdmZip();
    zip.addFile(
      'jcr_root/content/site/page/jcr:content/.content.xml',
      Buffer.from(`<jcr:root sling:resourceType="site/components/page" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"/>`),
    );
    zip.writeZip(path.join(dir, 'pkg1.zip'));

    const result = parseContentPackages([dir]);
    expect(result.usage.get('site/components/page')?.count).toBe(1);
    expect(result.meta.sitePageCounts['site']).toBe(1);
  });
});

describe('audit engine', () => {
  it('runs full audit on AEMaaCS project', () => {
    const root = createAemCloudFixture();
    const projects = detectAllProjects(root);
    const result = runAudit(projects);

    expect(result.summary.totalComponents).toBe(3);
    expect(result.summary.byClassification.custom).toBeGreaterThanOrEqual(1);
    expect(result.components.every((c) => c.site)).toBe(true);
    expect(result.components.every((c) => c.classification)).toBe(true);

    const button = result.components.find((c) => c.name === 'button');
    expect(button).toBeDefined();
    expect(button!.classification).toBe('proxied');
    expect(button!.ootbBase).toBe('core/wcm/components/button/v2/button');
    expect(button!.coreModelOverride).toBe(false);

    const hero = result.components.find((c) => c.name === 'hero');
    expect(hero).toBeDefined();
    expect(hero!.classification).toBe('custom');
    expect(hero!.coreModelOverride).toBe(false);

    const teaser = result.components.find((c) => c.name === 'teaser');
    expect(teaser).toBeDefined();
    expect(teaser!.classification).toBe('proxied-customized');
    expect(teaser!.customizations).toContain('custom dialog');
    expect(teaser!.customizations).toContain('custom HTL');
    expect(teaser!.hasSlingModel).toBe(true);
    expect(teaser!.coreModelOverride).toBe(true);
    expect(teaser!.modelClass).toBe('com.example.models.TeaserModel');

    expect(result.summary.withCoreModelOverride).toBe(1);
    expect(result.summary.coreProxiesWithoutModelOverride).toBe(1);
  });

  it('runs audit on AMS project', () => {
    const root = createAmsFixture();
    const projects = detectAllProjects(root);
    const result = runAudit(projects);

    expect(result.summary.totalComponents).toBe(1);
    expect(result.projects[0].platform).toBe('ams');
    expect(result.summary.migrationReadiness).not.toBeNull();
  });

  it('runs audit on mixed workspace', () => {
    const workspace = tmpDir();
    const cloud = createAemCloudFixture();
    const ams = createAmsFixture();
    fs.renameSync(cloud, path.join(workspace, 'cloud'));
    fs.renameSync(ams, path.join(workspace, 'ams'));
    tempDirs = tempDirs.filter((d) => d !== cloud && d !== ams);

    const projects = detectAllProjects(workspace);
    const result = runAudit(projects);

    expect(result.projects.length).toBe(2);
    expect(result.summary.totalComponents).toBe(4);
    expect(result.summary.totalSites).toBe(2);
  });

  it('generates Excel report', async () => {
    const root = createAemCloudFixture();
    const projects = detectAllProjects(root);
    const result = runAudit(projects);

    const outputDir = tmpDir();
    const outputPath = path.join(outputDir, 'audit-report.xlsx');
    await generateExcelReport(result, outputPath);

    expect(fs.existsSync(outputPath)).toBe(true);
    const stats = fs.statSync(outputPath);
    expect(stats.size).toBeGreaterThan(1000);
  });

  it('integrates content package usage into audit', () => {
    const root = createAemCloudFixture();
    const pkgDir = tmpDir();
    const zip = new AdmZip();
    zip.addFile(
      'jcr_root/content/mysite/en/jcr:content/.content.xml',
      Buffer.from(`<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0">
        <hero sling:resourceType="mysite/components/hero"/>
        <button1 sling:resourceType="mysite/components/button"/>
        <button2 sling:resourceType="mysite/components/button"/>
      </jcr:root>`),
    );
    zip.writeZip(path.join(pkgDir, 'content.zip'));

    const projects = detectAllProjects(root);
    const result = runAudit(projects, { contentPackagePaths: [pkgDir] });

    const hero = result.components.find((c) => c.name === 'hero');
    expect(hero!.usageCount).toBe(1);

    const button = result.components.find((c) => c.name === 'button');
    expect(button!.usageCount).toBe(2);

    const teaser = result.components.find((c) => c.name === 'teaser');
    expect(teaser!.usageCount).toBe(0);
    expect(result.summary.unusedComponents).toBeGreaterThanOrEqual(1);
  });

  it('generates recommendations for unused and JSP components', () => {
    const root = createAmsFixture();
    addComponent(root, 'legacysite', 'oldwidget', {
      title: 'Old Widget',
      group: 'Legacy - Content',
      superType: '',
    });
    // Add a JSP-only component (no HTL)
    const jspDir = path.join(root, 'ui.apps', 'src', 'main', 'content', 'jcr_root', 'apps', 'legacysite', 'components', 'oldwidget');
    write(jspDir, 'oldwidget.jsp', '<%@ page %><div>JSP</div>');

    const projects = detectAllProjects(root);
    const result = runAudit(projects);

    expect(result.recommendations.length).toBeGreaterThan(0);
    const categories = result.recommendations.map((r) => r.category);
    expect(categories).toContain('cleanup');
  });
});
