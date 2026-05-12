/**
 * Resolve AEM module paths from a detected project structure.
 * Supports both AEMaaCS (cloud) and AEM AMS (6.x) project layouts.
 */
import * as path from 'path';
import * as fs from 'fs';
import { ComponentLibraryConfig } from '../config/schema';

export interface AemPaths {
  root: string;
  core: string;
  uiApps: string;
  uiConfig: string | null;
  uiContent: string | null;
  all: string | null;

  /** Whether ui.config module exists (AEMaaCS) */
  hasUiConfig: boolean;
  /** Whether ui.content module exists */
  hasUiContent: boolean;

  /** Java source root for the core bundle */
  javaSrc: string;

  /** Servlet output path */
  servletFile(config: ComponentLibraryConfig): string;

  /** Page component folder under ui.apps */
  pageComponentDir(config: ComponentLibraryConfig): string;

  /** Clientlib folder under ui.apps */
  clientlibDir(config: ComponentLibraryConfig): string;

  /** OSGi config folder — ui.config for Cloud, ui.apps for AMS */
  osgiConfigDir(config: ComponentLibraryConfig): string;

  /** Content page folder under ui.content (AMS) — null for Cloud (uses RepoInit) */
  contentDir(config: ComponentLibraryConfig): string;
}

export function resolveAemPaths(projectRoot: string): AemPaths {
  const core = resolveModule(projectRoot, 'core');
  const uiApps = resolveModule(projectRoot, 'ui.apps');

  // Optional modules — AMS may not have ui.config, Cloud may not deploy ui.content
  const uiConfig = resolveModuleOptional(projectRoot, 'ui.config');
  const uiContent = resolveModuleOptional(projectRoot, 'ui.content');
  const all = resolveModuleOptional(projectRoot, 'all');

  const hasUiConfig = uiConfig !== null;
  const hasUiContent = uiContent !== null;

  // Detect java source root from core module
  const javaSrc = path.join(core, 'src', 'main', 'java');

  return {
    root: projectRoot,
    core,
    uiApps,
    uiConfig,
    uiContent,
    all,
    hasUiConfig,
    hasUiContent,
    javaSrc,

    servletFile(config: ComponentLibraryConfig): string {
      const pkgPath = config.output.servletPackage.replace(/\./g, '/');
      return path.join(javaSrc, pkgPath, 'ComponentLibraryServlet.java');
    },

    pageComponentDir(config: ComponentLibraryConfig): string {
      return path.join(
        uiApps, 'src', 'main', 'content', 'jcr_root',
        'apps', config.appId, 'components', 'page', 'componentlibrary'
      );
    },

    clientlibDir(config: ComponentLibraryConfig): string {
      return path.join(
        uiApps, 'src', 'main', 'content', 'jcr_root',
        'apps', config.appId, 'clientlibs', 'clientlib-componentlibrary'
      );
    },

    osgiConfigDir(config: ComponentLibraryConfig): string {
      // Prefer ui.config (Cloud), fall back to ui.apps (AMS)
      const base = uiConfig || uiApps;
      return path.join(
        base, 'src', 'main', 'content',
        'jcr_root', 'apps', config.appId, 'osgiconfig', 'config'
      );
    },

    contentDir(config: ComponentLibraryConfig): string {
      // For AMS, content page goes into ui.content (which IS deployed)
      // For Cloud, this path is only used as fallback — RepoInit is preferred
      const base = uiContent || uiApps;
      const segments = config.output.contentPath.split('/').filter(Boolean);
      return path.join(
        base, 'src', 'main', 'content', 'jcr_root',
        ...segments
      );
    },
  };
}

function resolveModule(root: string, name: string): string {
  const dir = path.join(root, name);
  if (!fs.existsSync(dir)) {
    throw new Error(`AEM module "${name}" not found at: ${dir}`);
  }
  return dir;
}

function resolveModuleOptional(root: string, name: string): string | null {
  const dir = path.join(root, name);
  return fs.existsSync(dir) ? dir : null;
}
