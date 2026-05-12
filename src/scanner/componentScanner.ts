/**
 * Scan local workspace component definitions (from JCR source files).
 * Reads .content.xml files under /apps/<appId>/components/ to build metadata.
 */
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { ComponentLibraryConfig } from '../config/schema';

export interface ScannedComponent {
  name: string;
  title: string;
  description: string;
  group: string;
  resourceType: string;
  superType: string;
  isContainer: boolean;
  hasDialog: boolean;
  hasEditConfig: boolean;
  hasReadme: boolean;
  hasThumbnail: boolean;
  thumbnailFile: string;
  layoutFiles: string[];
  path: string;
}

export interface ScanResult {
  total: number;
  groups: Record<string, number>;
  components: ScannedComponent[];
}

/**
 * Scan the local workspace for AEM components.
 */
export function scanComponents(projectRoot: string, config: ComponentLibraryConfig): ScanResult {
  const componentsDir = path.join(
    projectRoot, 'ui.apps', 'src', 'main', 'content', 'jcr_root',
    'apps', config.appId, 'components'
  );

  if (!fs.existsSync(componentsDir)) {
    return { total: 0, groups: {}, components: [] };
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const components: ScannedComponent[] = [];
  const groups: Record<string, number> = {};
  const excludedGroups = new Set(config.components.groups.exclude);
  const thumbnailNames = new Set(config.components.thumbnails.fileNames);
  const layoutExclude = config.components.layouts.exclude.map(p =>
    new RegExp('^' + p.replace(/\*/g, '.*') + '$', 'i')
  );

  const entries = fs.readdirSync(componentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) { continue; }

    const compDir = path.join(componentsDir, entry.name);
    const contentXml = path.join(compDir, '.content.xml');
    if (!fs.existsSync(contentXml)) { continue; }

    try {
      const xml = fs.readFileSync(contentXml, 'utf-8');
      const doc = parser.parse(xml);
      const root = doc['jcr:root'] || doc;

      const primaryType = root['@_jcr:primaryType'];
      if (primaryType !== 'cq:Component') { continue; }

      const componentGroup = root['@_componentGroup'] || '';
      if (!componentGroup || excludedGroups.has(componentGroup)) { continue; }

      const name = entry.name;
      const title = root['@_jcr:title'] || name;
      const description = root['@_jcr:description'] || '';
      const superType = root['@_sling:resourceSuperType'] || '';
      const isContainer = root['@_cq:isContainer'] === '{Boolean}true' || root['@_cq:isContainer'] === 'true';

      // Check for dialog
      const hasDialog = fs.existsSync(path.join(compDir, '_cq_dialog', '.content.xml')) ||
                         fs.existsSync(path.join(compDir, 'cq:dialog'));

      // Check for editConfig
      const hasEditConfig = fs.existsSync(path.join(compDir, '_cq_editConfig', '.content.xml')) ||
                             fs.existsSync(path.join(compDir, 'cq:editConfig'));

      // Check for README
      const hasReadme = fs.existsSync(path.join(compDir, 'README.md'));

      // Check for thumbnail
      let hasThumbnail = false;
      let thumbnailFile = '';
      for (const tn of thumbnailNames) {
        if (fs.existsSync(path.join(compDir, tn))) {
          hasThumbnail = true;
          thumbnailFile = tn;
          break;
        }
      }

      // Check for layouts
      const layoutFiles: string[] = [];
      const layoutDir = path.join(compDir, config.components.layouts.folderName);
      if (fs.existsSync(layoutDir)) {
        const layoutEntries = fs.readdirSync(layoutDir);
        for (const lf of layoutEntries) {
          if (/\.(svg|png|jpg|webp)$/i.test(lf)) {
            const isExcluded = layoutExclude.some(re => re.test(lf));
            if (isExcluded) {
              // Layout-excluded files (like thumbnail.*) can serve as thumbnail fallback
              if (!hasThumbnail) {
                hasThumbnail = true;
                thumbnailFile = `${config.components.layouts.folderName}/${lf}`;
              }
            } else {
              layoutFiles.push(lf);
            }
          }
        }
      }

      components.push({
        name,
        title,
        description,
        group: componentGroup,
        resourceType: `${config.appId}/components/${name}`,
        superType,
        isContainer,
        hasDialog,
        hasEditConfig,
        hasReadme,
        hasThumbnail,
        thumbnailFile,
        layoutFiles,
        path: `/apps/${config.appId}/components/${name}`,
      });

      groups[componentGroup] = (groups[componentGroup] || 0) + 1;
    } catch {
      // Skip malformed component definitions
    }
  }

  // Sort components by title
  components.sort((a, b) => a.title.localeCompare(b.title));

  return { total: components.length, groups, components };
}
