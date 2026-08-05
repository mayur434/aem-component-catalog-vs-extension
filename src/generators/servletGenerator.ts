import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import type { GeneratedArtifact } from '../core/artifact';
import type { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';

export function planServlet(config: ComponentLibraryConfig, paths: AemPaths): GeneratedArtifact[] {
  const servletDir = path.dirname(paths.servletFile(config));
  const staticCatalogDamPath = `${config.output.assetRoot}/components-catalog.json`;
  const staticCatalogContentPath = `/content/${config.appId}/catalog-data`;
  const categoryLabels = Object.entries(config.taxonomy.categoryLabels).map(([key, label]) => ({
    key,
    label,
  }));
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
        staticCatalogDamPath,
        staticCatalogContentPath,
        resourceType: config.output.pageResourceType,
        subServiceName: config.serviceUser.subServiceName,
        excludedGroups: config.components.groups.exclude,
        excludedLeafNames: config.components.exclude.leafNames,
        excludedSuperTypeTokens: config.components.exclude.superTypeTokens,
        thumbnailFileNames: config.components.thumbnails.fileNames,
        layoutFolderName: config.components.layouts.folderName,
        layoutExclude: config.components.layouts.exclude,
        ownerProperty: config.governance.ownerProperty,
        statusProperty: config.governance.statusProperty,
        versionProperty: config.governance.versionProperty,
        tagsProperty: config.governance.tagsProperty,
        subCategoryProperty: config.taxonomy.subCategoryProperty,
        categoryLabels,
        cacheSeconds: config.catalog.cacheSeconds,
        pageSize: config.catalog.pageSize,
        requirePublishedUsage: config.catalog.requirePublishedUsage,
        serveOnPublish: config.catalog.serveOnPublish,
      }),
    },
    {
      absolutePath: path.join(servletDir, 'CatalogGeneratorService.java'),
      kind: 'java',
      content: renderTemplate('CatalogGeneratorService.java.hbs', {
        package: config.output.servletPackage,
        componentRoot: config.components.root,
        subServiceName: config.serviceUser.subServiceName,
        staticCatalogDamPath,
        staticCatalogContentPath,
        generatorCron: config.catalog.generatorCron,
        excludedGroups: config.components.groups.exclude,
        excludedLeafNames: config.components.exclude.leafNames,
        excludedSuperTypeTokens: config.components.exclude.superTypeTokens,
        categoryLabels,
        ownerProperty: config.governance.ownerProperty,
        statusProperty: config.governance.statusProperty,
        versionProperty: config.governance.versionProperty,
        subCategoryProperty: config.taxonomy.subCategoryProperty,
      }),
    },
    {
      absolutePath: path.join(servletDir, 'ComponentFingerprint.java'),
      kind: 'java',
      content: renderTemplate('ComponentFingerprint.java.hbs', {
        package: config.output.servletPackage,
      }),
    },
    {
      absolutePath: path.join(servletDir, 'ComponentDuplicateService.java'),
      kind: 'java',
      content: renderTemplate('ComponentDuplicateService.java.hbs', {
        package: config.output.servletPackage,
        componentRoot: config.components.root,
        subServiceName: config.serviceUser.subServiceName,
        excludedGroups: config.components.groups.exclude,
        excludedLeafNames: config.components.exclude.leafNames,
        excludedSuperTypeTokens: config.components.exclude.superTypeTokens,
        categoryLabels,
      }),
    },
  ];
}
