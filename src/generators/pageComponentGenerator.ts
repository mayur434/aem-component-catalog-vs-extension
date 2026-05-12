/**
 * Generate the page component (body.html, header/footer libs, component definition).
 */
import * as path from 'path';
import { ComponentLibraryConfig } from '../config/schema';
import { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';
import { WriteResult, writeFile } from '../utils/fileOps';
import { Manifest, addToManifest } from '../utils/manifest';

export function generatePageComponent(
  config: ComponentLibraryConfig,
  paths: AemPaths,
  manifest: Manifest,
): WriteResult[] {
  const dir = paths.pageComponentDir(config);
  const results: WriteResult[] = [];

  // Component definition .content.xml
  const compDef = renderTemplate('componentDef.content.xml.hbs', {
    appId: config.appId,
    pageTitle: config.output.pageTitle,
  });
  let fp = path.join(dir, '.content.xml');
  results.push(writeFile(fp, compDef));
  addToManifest(manifest, fp, compDef);

  // body.html
  const body = renderTemplate('body.html.hbs', {
    appId: config.appId,
    hero: config.hero,
    features: config.features,
  });
  fp = path.join(dir, 'body.html');
  results.push(writeFile(fp, body));
  addToManifest(manifest, fp, body);

  // customheaderlibs.html
  const header = renderTemplate('customheaderlibs.html.hbs', {
    clientlibCategory: config.output.clientlibCategory,
  });
  fp = path.join(dir, 'customheaderlibs.html');
  results.push(writeFile(fp, header));
  addToManifest(manifest, fp, header);

  // customfooterlibs.html
  const footer = renderTemplate('customfooterlibs.html.hbs', {
    clientlibCategory: config.output.clientlibCategory,
  });
  fp = path.join(dir, 'customfooterlibs.html');
  results.push(writeFile(fp, footer));
  addToManifest(manifest, fp, footer);

  return results;
}
