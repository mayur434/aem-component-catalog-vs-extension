/**
 * Generate the clientlib (JS + CSS + structure).
 */
import * as path from 'path';
import { ComponentLibraryConfig } from '../config/schema';
import { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';
import { WriteResult, writeFile } from '../utils/fileOps';
import { Manifest, addToManifest } from '../utils/manifest';

export function generateClientlib(
  config: ComponentLibraryConfig,
  paths: AemPaths,
  manifest: Manifest,
): WriteResult[] {
  const dir = paths.clientlibDir(config);
  const results: WriteResult[] = [];

  // Clientlib .content.xml
  const clDef = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:ClientLibraryFolder"
    categories="[${config.output.clientlibCategory}]"/>
`;
  let fp = path.join(dir, '.content.xml');
  results.push(writeFile(fp, clDef));
  addToManifest(manifest, fp, clDef);

  // js.txt
  const jsTxt = '#base=js\nscripts.js\n';
  fp = path.join(dir, 'js.txt');
  results.push(writeFile(fp, jsTxt));
  addToManifest(manifest, fp, jsTxt);

  // css.txt
  const cssTxt = '#base=css\nstyles.css\n';
  fp = path.join(dir, 'css.txt');
  results.push(writeFile(fp, cssTxt));
  addToManifest(manifest, fp, cssTxt);

  // scripts.js
  const js = renderTemplate('scripts.js.hbs', {
    appId: config.appId,
    features: config.features,
    components: config.components,
    hero: config.hero,
  });
  // Ensure js/ folder has a valid CRX node definition
  const jsFolderDef = `<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"\n    jcr:primaryType="nt:folder"/>\n`;
  let jsFolderXml = path.join(dir, 'js', '.content.xml');
  results.push(writeFile(jsFolderXml, jsFolderDef));
  addToManifest(manifest, jsFolderXml, jsFolderDef);
  fp = path.join(dir, 'js', 'scripts.js');
  results.push(writeFile(fp, js));
  addToManifest(manifest, fp, js);

  // styles.css
  const css = renderTemplate('styles.css.hbs', {
    brand: config.brand,
    features: config.features,
  });
  // Ensure css/ folder has a valid CRX node definition
  const cssFolderDef = `<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"\n    jcr:primaryType="nt:folder"/>\n`;
  let cssFolderXml = path.join(dir, 'css', '.content.xml');
  results.push(writeFile(cssFolderXml, cssFolderDef));
  addToManifest(manifest, cssFolderXml, cssFolderDef);
  fp = path.join(dir, 'css', 'styles.css');
  results.push(writeFile(fp, css));
  addToManifest(manifest, fp, css);

  return results;
}
