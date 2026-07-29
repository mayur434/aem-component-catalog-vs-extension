/** Resolve standard AEM as a Cloud Service project locations. */
import * as fs from 'fs';
import * as path from 'path';
import type { ComponentLibraryConfig } from '../config/schema';
import { assertPathInside } from './pathSecurity';

export interface AemPaths {
  root: string;
  core: string;
  uiApps: string;
  uiConfig: string;
  uiContent: string | null;
  all: string;
  javaSrc: string;
  servletFile(config: ComponentLibraryConfig): string;
  pageComponentDir(config: ComponentLibraryConfig): string;
  clientlibDir(config: ComponentLibraryConfig): string;
  osgiConfigDir(config: ComponentLibraryConfig): string;
}

export function resolveAemPaths(projectRoot: string): AemPaths {
  const root = fs.realpathSync(projectRoot);
  const core = requireModule(root, 'core');
  const uiApps = requireModule(root, 'ui.apps');
  const uiConfig = requireModule(root, 'ui.config');
  const all = requireModule(root, 'all');
  const uiContent = optionalModule(root, 'ui.content');
  const javaSrc = path.join(core, 'src', 'main', 'java');

  const within = (candidate: string): string => assertPathInside(root, candidate, 'Generated output');

  return {
    root,
    core,
    uiApps,
    uiConfig,
    uiContent,
    all,
    javaSrc,
    servletFile(config) {
      return within(
        path.join(javaSrc, config.output.servletPackage.replace(/\./g, '/'), 'ComponentLibraryServlet.java'),
      );
    },
    pageComponentDir(config) {
      return within(
        path.join(
          uiApps,
          'src',
          'main',
          'content',
          'jcr_root',
          'apps',
          config.appId,
          'components',
          'page',
          'componentlibrary',
        ),
      );
    },
    clientlibDir(config) {
      return within(
        path.join(
          uiApps,
          'src',
          'main',
          'content',
          'jcr_root',
          'apps',
          config.appId,
          'clientlibs',
          'clientlib-componentlibrary',
        ),
      );
    },
    osgiConfigDir(config) {
      // Applies to every run mode (author and publish), not just config.author. The core
      // bundle itself deploys to both tiers by default (nothing tier-restricts it at the
      // package level), and ComponentUsageService/the service-user mapping have no run-mode
      // guard of their own - if this lived under config.author only, the bundle would still
      // activate on publish but fail every night with a LoginException (no subservice mapping
      // there). The catalog UI itself still only responds on author: that gate is a runtime
      // check inside the servlet, unrelated to which OSGi config folder this is.
      return within(
        path.join(
          uiConfig,
          'src',
          'main',
          'content',
          'jcr_root',
          'apps',
          config.appId,
          'osgiconfig',
          'config',
        ),
      );
    },
  };
}

function requireModule(root: string, name: string): string {
  const modulePath = path.join(root, name);
  if (!fs.existsSync(modulePath)) {
    throw new Error(`Required AEMaaCS module "${name}" not found at ${modulePath}`);
  }
  return fs.realpathSync(modulePath);
}

function optionalModule(root: string, name: string): string | null {
  const modulePath = path.join(root, name);
  return fs.existsSync(modulePath) ? fs.realpathSync(modulePath) : null;
}
