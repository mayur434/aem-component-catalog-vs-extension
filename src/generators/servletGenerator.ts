import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';

export function planServlet(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  const servletDir = path.dirname(paths.servletFile(config));
  return [
    {
      absolutePath: path.join(servletDir, 'ComponentUsageService.java'),
      kind: 'java',
      content: renderTemplate('ComponentUsageService.java.hbs', {
        package: config.output.servletPackage,
        componentRoot: config.components.root,
        subServiceName: config.serviceUser.subServiceName,
        catalogContentRoot: `/content/${config.appId}`,
        usageCron: config.catalog.usageCron,
      }),
    },
    {
      absolutePath: paths.servletFile(config),
      kind: 'java',
      content: renderTemplate('ComponentLibraryServlet.java.hbs', {
        package: config.output.servletPackage,
        appId: config.appId,
        componentRoot: config.components.root,
        assetRoot: config.output.assetRoot,
        resourceType: config.output.pageResourceType,
        subServiceName: config.serviceUser.subServiceName,
        excludedGroups: config.components.groups.exclude,
        thumbnailFileNames: config.components.thumbnails.fileNames,
        layoutFolderName: config.components.layouts.folderName,
        layoutExclude: config.components.layouts.exclude,
        ownerProperty: config.governance.ownerProperty,
        statusProperty: config.governance.statusProperty,
        versionProperty: config.governance.versionProperty,
        tagsProperty: config.governance.tagsProperty,
        subCategoryProperty: config.taxonomy.subCategoryProperty,
        categoryLabels: Object.entries(config.taxonomy.categoryLabels).map(([key, label]) => ({
          key,
          label,
        })),
        cacheSeconds: config.catalog.cacheSeconds,
        pageSize: config.catalog.pageSize,
      }),
    },
  ];
}
