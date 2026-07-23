import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';

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
    pageResourceType: config.output.pageResourceType,
    pageTitle: config.output.pageTitle,
    pagePaths: contentPagePaths(config.output.contentPath),
  });
  return [
    {
      absolutePath: path.join(
        directory,
        `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended~${config.appId}.cfg.json`,
      ),
      content: mapper,
      kind: 'osgi',
    },
    {
      absolutePath: path.join(
        directory,
        `org.apache.sling.jcr.repoinit.RepositoryInitializer~${config.appId}.cfg.json`,
      ),
      content: repoinit,
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
