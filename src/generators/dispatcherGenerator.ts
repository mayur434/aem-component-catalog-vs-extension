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
 * Emitted as a single loose file at the project root, deliberately NOT into a
 * dispatcher/src/conf.dispatcher.d/... tree. A catalog project usually does not own the
 * dispatcher configuration - Cloud Manager only applies dispatcher config from the
 * repository its own pipeline builds - and generating the conventional folder layout here
 * produces something that looks like a dispatcher module but has no pom.xml and is in no
 * reactor, so nothing ever builds or deploys it. A clearly-named standalone file makes it
 * obvious this is a portable artifact to copy into the repository that does own the
 * dispatcher config.
 */
export function planDispatcher(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  if (!config.catalog.serveOnPublish) return [];
  return [
    {
      absolutePath: path.join(paths.root, 'component-catalog-dispatcher-filters.any'),
      content: renderTemplate('dispatcherFilters.any.hbs', {
        appId: config.appId,
        contentPath: config.output.contentPath,
        assetRoot: config.output.assetRoot,
      }),
      kind: 'content',
    },
  ];
}
