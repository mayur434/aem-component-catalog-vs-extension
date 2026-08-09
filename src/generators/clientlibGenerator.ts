import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';

const folderDefinition = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="nt:folder"/>
`;

export function planClientlib(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  const directory = paths.clientlibDir(config);
  const definition = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:ClientLibraryFolder"
    allowProxy="{Boolean}true"
    categories="[${config.output.clientlibCategory}]"/>
`;
  return [
    clientlib(path.join(directory, '.content.xml'), definition),
    clientlib(path.join(directory, 'js.txt'), '#base=js\nscripts.js\n'),
    clientlib(path.join(directory, 'css.txt'), '#base=css\nstyles.css\n'),
    clientlib(path.join(directory, 'js', '.content.xml'), folderDefinition),
    clientlib(
      path.join(directory, 'js', 'scripts.js'),
      renderTemplate('scripts.js.hbs', {
        appId: config.appId,
        features: config.features,
        components: config.components,
        hero: config.hero,
        catalog: config.catalog,
      }),
    ),
    clientlib(path.join(directory, 'css', '.content.xml'), folderDefinition),
    clientlib(
      path.join(directory, 'css', 'styles.css'),
      renderTemplate('styles.css.hbs', { brand: config.brand, features: config.features }),
    ),
  ];
}

function clientlib(absolutePath: string, content: string): GeneratedArtifact {
  return { absolutePath, content, kind: 'clientlib' };
}
