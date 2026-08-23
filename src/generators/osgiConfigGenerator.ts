import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';
import { uniqueSiteDomainCategories } from './siteDomainServiceGenerator';

export function planOsgiConfigs(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  const directory = paths.osgiConfigDir(config);
  const mapper = renderTemplate('serviceUserMapper.cfg.json.hbs', {
    bundleSymbolicName: config.serviceUser.bundleSymbolicName,
    subServiceName: config.serviceUser.subServiceName,
    serviceUserName: config.serviceUser.name,
  });
  const repoinit = renderTemplate('repoinit.cfg.json.hbs', {
    serviceUserName: config.serviceUser.name,
    contentPath: config.output.contentPath,
    componentRoot: config.components.root,
    appId: config.appId,
    assetRoot: config.output.assetRoot,
    pageResourceType: config.output.pageResourceType,
    pageTitle: config.output.pageTitle,
    pagePaths: contentPagePaths(config.output.contentPath),
    usageIndexName: config.catalog.usageIndexName,
  });
  return [
    {
      absolutePath: path.join(
        directory,
        `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended~${osgiConfigSuffix(config)}.cfg.json`,
      ),
      content: mapper,
      kind: 'osgi',
    },
    {
      absolutePath: path.join(
        directory,
        `org.apache.sling.jcr.repoinit.RepositoryInitializer~${osgiConfigSuffix(config)}.cfg.json`,
      ),
      content: repoinit,
      kind: 'osgi',
    },
  ];
}

/**
 * Factory-config PID suffix for the catalog's own ServiceUserMapperImpl.amended and
 * RepositoryInitializer files. Deliberately NOT the bare appId: the standard AEM Project
 * Archetype already scaffolds its own site-wide `~<appId>` service-user-mapper and repoinit
 * files for every new reactor. Reusing that exact suffix would make the catalog's generated
 * file land on the exact same path as that pre-existing, unrelated file - which the
 * generation planner then treats as a manually-modified conflict and, being conservative by
 * design, refuses to overwrite it. On a fresh archetype-based project this silently leaves
 * the catalog's RepoInit/service-user config never actually written, even though the plan
 * reports no error. A dedicated suffix keeps our factory config in its own file, additive to
 * (never colliding with) whatever the archetype or other features already contributed.
 */
export function osgiConfigSuffix(config: ComponentLibraryConfig): string {
  return `${config.appId}-componentlibrary`;
}

/**
 * SiteDomainService's per-environment domain values, written into config.stage/config.prod
 * (never config.author - see osgiConfigDirForRunMode's doc comment). Skipped entirely, with
 * no artifacts at all, when the project has no site-domain entries configured: this feature
 * is opt-in, and an empty result here means the Java class isn't generated either (see
 * planSiteDomainService), so there is nothing for this config to configure.
 */
export function planSiteDomainOsgiConfigs(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  const categories = uniqueSiteDomainCategories(config);
  if (categories.length === 0) return [];

  const byCategory = new Map(config.taxonomy.siteDomains.map((entry) => [entry.category, entry]));
  // shortenPath is one value per site, not per run mode - a site's Dispatcher rewrite behaviour
  // is a fixed property of its own rewrite.rules, which stage and prod share, so the same
  // value is written into both generated config files.
  const entriesFor = (runMode: 'stage' | 'prod'): string[] =>
    categories.map((category) => {
      const entry = byCategory.get(category);
      const domain = (runMode === 'prod' ? entry?.prodDomain : entry?.stageDomain) ?? '';
      return `${category}=${domain}=${entry?.shortenPath ?? ''}`;
    });

  // PID equals the fully-qualified class name of the generated SiteDomainService, in the
  // same package resolution the other generated servlets/services use - a normal
  // @Designate-based singleton config, not the "~{appId}" amended factory-config suffix
  // style used by the two configs above (those are Sling factory configs; this is not).
  const fileName = `${config.output.servletPackage}.SiteDomainService.cfg.json`;

  return [
    {
      absolutePath: path.join(paths.osgiConfigDirForRunMode(config, 'prod'), fileName),
      content: renderTemplate('siteDomainService.cfg.json.hbs', { siteDomains: entriesFor('prod') }),
      kind: 'osgi',
    },
    {
      absolutePath: path.join(paths.osgiConfigDirForRunMode(config, 'stage'), fileName),
      content: renderTemplate('siteDomainService.cfg.json.hbs', { siteDomains: entriesFor('stage') }),
      kind: 'osgi',
    },
  ];
}

function contentPagePaths(contentPath: string): Array<{ path: string; target: boolean }> {
  const segments = contentPath.split('/').filter(Boolean);
  const paths: Array<{ path: string; target: boolean }> = [];
  for (let index = 1; index < segments.length; index += 1) {
    paths.push({
      path: `/${segments.slice(0, index + 1).join('/')}`,
      target: index === segments.length - 1,
    });
  }
  return paths;
}
