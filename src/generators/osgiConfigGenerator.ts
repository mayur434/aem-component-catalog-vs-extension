/**
 * Generate OSGi configuration files (service user mapper + repoinit).
 */
import * as path from 'path';
import * as fs from 'fs';
import { ComponentLibraryConfig } from '../config/schema';
import { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';
import { WriteResult, writeFile } from '../utils/fileOps';
import { Manifest, addToManifest } from '../utils/manifest';

export function generateOsgiConfigs(
  config: ComponentLibraryConfig,
  paths: AemPaths,
  manifest: Manifest,
): WriteResult[] {
  const results: WriteResult[] = [];

  const isAms = config.projectType === 'ams';

  // Resolve the osgiconfig dir:
  //  - AEMaaCS: always from ui.config
  //  - AMS: from ui.config if it exists, otherwise ui.apps
  const configBase = paths.uiConfig || paths.uiApps;
  const configDir = findOsgiConfigDir(configBase, config.appId);

  // Service User Mapper Amendment
  const mapperContent = renderTemplate('serviceUserMapper.cfg.json.hbs', {
    bundleSymbolicName: config.serviceUser.bundleSymbolicName,
    subServiceName: config.serviceUser.subServiceName,
    serviceUserName: config.serviceUser.name,
  });
  const mapperFile = path.join(
    configDir,
    `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended~${config.appId}.cfg.json`
  );
  results.push(writeFile(mapperFile, mapperContent));
  addToManifest(manifest, mapperFile, mapperContent);

  // Repoinit:
  //  - AEMaaCS: full template (service user + ACLs + template + content page)
  //  - AMS: simple template (service user + ACLs only — content page is a file in ui.content)
  const repoinitTemplate = isAms ? 'repoinit-ams.cfg.json.hbs' : 'repoinit.cfg.json.hbs';
  const repoinitContent = renderTemplate(repoinitTemplate, {
    serviceUserName: config.serviceUser.name,
    contentPath: config.output.contentPath,
    componentRoot: config.components.root,
    appId: config.appId,
    pageResourceType: config.output.pageResourceType,
    pageTitle: config.output.pageTitle,
  });
  const repoinitFile = path.join(
    configDir,
    `org.apache.sling.jcr.repoinit.RepositoryInitializer~${config.appId}.cfg.json`
  );
  results.push(writeFile(repoinitFile, repoinitContent));
  addToManifest(manifest, repoinitFile, repoinitContent);

  return results;
}

function findOsgiConfigDir(uiConfigRoot: string, appId: string): string {
  const jcrRoot = path.join(uiConfigRoot, 'src', 'main', 'content', 'jcr_root');

  // Try exact known patterns in order of preference
  const patterns = [
    path.join(jcrRoot, 'apps', appId, 'osgiconfig', 'config'),
    path.join(jcrRoot, 'apps', appId, 'config'),
  ];

  for (const p of patterns) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Walk apps/<appId> looking for an existing directory named 'config'
  // that already contains .cfg.json files (not config.author, config.publish, etc.)
  const appDir = path.join(jcrRoot, 'apps', appId);
  if (fs.existsSync(appDir)) {
    const found = findConfigDirWithCfgFiles(appDir, 3);
    if (found) { return found; }
  }

  // Default: create under the standard osgiconfig/config path
  const defaultDir = patterns[0];
  fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}

function findConfigDirWithCfgFiles(dir: string, maxDepth: number): string | null {
  if (maxDepth <= 0) { return null; }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) { continue; }
      const fullPath = path.join(dir, entry.name);
      // Only match directories named exactly 'config' (not config.author, etc.)
      if (entry.name === 'config') {
        // Verify it actually contains .cfg.json files
        const files = fs.readdirSync(fullPath);
        if (files.some(f => f.endsWith('.cfg.json'))) {
          return fullPath;
        }
      }
      const result = findConfigDirWithCfgFiles(fullPath, maxDepth - 1);
      if (result) { return result; }
    }
  } catch { /* ignore */ }
  return null;
}
