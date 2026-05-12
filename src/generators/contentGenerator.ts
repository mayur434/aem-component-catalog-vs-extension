/**
 * Generate the content page definition.
 * - AEMaaCS (cloud): no-op — page is created via RepoInit in ui.config.
 * - AEM AMS: generates .content.xml under ui.content (which IS deployed).
 */
import * as path from 'path';
import { ComponentLibraryConfig } from '../config/schema';
import { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';
import { WriteResult, writeFile } from '../utils/fileOps';
import { Manifest, addToManifest } from '../utils/manifest';

export function generateContent(
  config: ComponentLibraryConfig,
  paths: AemPaths,
  manifest: Manifest,
): WriteResult[] {
  // On AEMaaCS, content page is created via RepoInit (ui.config), not as a file
  if (config.projectType !== 'ams') {
    return [];
  }

  // On AMS, generate the content page under ui.content
  const dir = paths.contentDir(config);
  const results: WriteResult[] = [];

  const content = renderTemplate('content.xml.hbs', {
    pageTitle: config.output.pageTitle,
    pageResourceType: config.output.pageResourceType,
    appId: config.appId,
  });

  const fp = path.join(dir, '.content.xml');
  results.push(writeFile(fp, content));
  addToManifest(manifest, fp, content);

  return results;
}
