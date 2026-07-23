import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';

export function planPageComponent(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  const directory = paths.pageComponentDir(config);
  return [
    artifact(path.join(directory, '.content.xml'), 'componentDef.content.xml.hbs', {
      appId: config.appId,
      pageTitle: config.output.pageTitle,
    }),
    artifact(path.join(directory, 'body.html'), 'body.html.hbs', {
      appId: config.appId,
      hero: config.hero,
      features: config.features,
    }),
    artifact(path.join(directory, 'customheaderlibs.html'), 'customheaderlibs.html.hbs', {
      clientlibCategory: config.output.clientlibCategory,
    }),
    artifact(path.join(directory, 'customfooterlibs.html'), 'customfooterlibs.html.hbs', {
      clientlibCategory: config.output.clientlibCategory,
    }),
  ];
}

function artifact(
  absolutePath: string,
  template: string,
  context: Record<string, unknown>,
): GeneratedArtifact {
  return { absolutePath, content: renderTemplate(template, context), kind: 'htl' };
}
