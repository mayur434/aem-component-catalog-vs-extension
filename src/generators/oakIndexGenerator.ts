import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';

/**
 * Lucene index backing the component-usage crawl. The crawl queries
 * "sling:resourceType LIKE '%/components/%'" under /content - a leading-and-trailing
 * wildcard Oak cannot serve from an ordinary property index, so without this it falls back
 * to a full unindexed repository traversal on every rebuild.
 *
 * Deployed as part of ui.apps (the code package) rather than via RepoInit or ui.content:
 * AEMaaCS installs and reindexes /oak:index definitions before the blue-green switchover,
 * which only happens for index definitions that arrive as code. RepoInit runs later, at
 * bundle startup, so a RepoInit-created index never gets that managed reindex.
 */
export function planOakIndex(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  return [
    {
      absolutePath: paths.oakIndexFile(config),
      content: renderTemplate('oakIndex.content.xml.hbs', {}),
      kind: 'content',
    },
  ];
}
