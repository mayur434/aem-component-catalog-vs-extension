import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';

/**
 * Deduplicated, order-preserving list of the categories that have a site-domain entry.
 * Shared by planSiteDomainService (Java defaults) and planSiteDomainOsgiConfigs (per-run-mode
 * config content) so both agree on exactly which categories exist.
 */
export function uniqueSiteDomainCategories(config: ComponentLibraryConfig): string[] {
  const seen = new Set<string>();
  for (const entry of config.taxonomy.siteDomains) {
    if (entry.category) seen.add(entry.category);
  }
  return [...seen];
}

/**
 * The SiteDomainService OSGi component (and its Java-annotation defaults) is only generated
 * when the project has actually configured at least one site-domain mapping. An empty
 * taxonomy.siteDomains means this feature was never opted into for this project, so nothing
 * about it - Java class, @Reference wiring in ComponentUsageService, OSGi config - should
 * appear in the generated output.
 */
export function planSiteDomainService(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  const categories = uniqueSiteDomainCategories(config);
  if (categories.length === 0) return [];

  const servletDir = path.dirname(paths.servletFile(config));
  // Annotation defaults stay ALWAYS-BLANK placeholders ("<category>=") - the real domain
  // values only ever live in the generated config.stage/config.prod OSGi config content,
  // never hardcoded into the Java annotation defaults.
  const siteDomainCategories = categories.map((category) => ({ category, entry: `${category}=` }));

  return [
    {
      absolutePath: path.join(servletDir, 'SiteDomainService.java'),
      kind: 'java',
      content: renderTemplate('SiteDomainService.java.hbs', {
        package: config.output.servletPackage,
        ocdName: `${config.appId} - Site Domain Mapping`,
        exampleEntry: `${categories[0]}=https://www.example.com=/content/${categories[0]}`,
        siteDomainCategories,
      }),
    },
  ];
}
