/**
 * Generate the ComponentLibraryServlet.java from template.
 */
import { ComponentLibraryConfig } from '../config/schema';
import { AemPaths } from '../utils/aemPaths';
import { renderTemplate } from '../utils/templateEngine';
import { WriteResult } from '../utils/fileOps';
import { Manifest, addToManifest } from '../utils/manifest';
import * as fileOps from '../utils/fileOps';

export function generateServlet(
  config: ComponentLibraryConfig,
  paths: AemPaths,
  manifest: Manifest,
): WriteResult {
  const content = renderTemplate('ComponentLibraryServlet.java.hbs', {
    package: config.output.servletPackage,
    appId: config.appId,
    componentRoot: config.components.root,
    resourceType: config.output.pageResourceType,
    subServiceName: config.serviceUser.subServiceName,
    excludedGroups: config.components.groups.exclude,
    thumbnailFileNames: config.components.thumbnails.fileNames,
    layoutFolderName: config.components.layouts.folderName,
    layoutExclude: config.components.layouts.exclude,
  });

  const filePath = paths.servletFile(config);
  const result = fileOps.writeFile(filePath, content);
  addToManifest(manifest, filePath, content);
  return result;
}
