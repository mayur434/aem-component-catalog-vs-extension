import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';

/**
 * Dispatcher allow rules for serving the catalog on publish.
 *
 * Only generated when `catalog.serveOnPublish` is set: on an author-only catalog the
 * dispatcher never sees these requests, so the file would be dead weight.
 *
 * Written to the conventional AEMaaCS location (dispatcher/src/conf.dispatcher.d/filters/)
 * so it drops straight into a standard dispatcher module. If this project has no dispatcher
 * module, the file still needs to be copied into whichever repository owns the dispatcher
 * configuration for the target program - Cloud Manager only applies dispatcher config from
 * the repository its pipeline builds.
 */
export function planDispatcher(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  if (!config.catalog.serveOnPublish) return [];
  return [
    {
      absolutePath: path.join(
        paths.root,
        'dispatcher',
        'src',
        'conf.dispatcher.d',
        'filters',
        'component-catalog-filters.any',
      ),
      content: renderTemplate('dispatcherFilters.any.hbs', {
        appId: config.appId,
        contentPath: config.output.contentPath,
        assetRoot: config.output.assetRoot,
      }),
      kind: 'content',
    },
  ];
}
