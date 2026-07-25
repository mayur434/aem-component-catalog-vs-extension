/**
 * Ensure the FileVault workspace filters cover the generated artifacts.
 *
 * The generator writes a page component, a clientlib, and OSGi configs under
 * /apps. If the module's META-INF/vault/filter.xml does not cover those paths,
 * `filevault-package-maven-plugin` fails the build with "files are not covered
 * by a filter rule". This adds the missing `<filter root="…"/>` entries —
 * additive and idempotent; it never removes or rewrites existing rules.
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config/loader';
import { resolveAemPaths } from '../utils/aemPaths';

export function ensureFilterCoverage(projectRoot: string): void {
  let paths;
  try {
    const config = loadConfig(projectRoot);
    paths = resolveAemPaths(projectRoot);
    patchFilter(vaultFilter(paths.uiApps), [
      jcrPathOf(paths.pageComponentDir(config), paths.uiApps),
      jcrPathOf(paths.clientlibDir(config), paths.uiApps),
    ]);
    patchFilter(vaultFilter(paths.uiConfig), [jcrPathOf(paths.osgiConfigDir(config), paths.uiConfig)]);
  } catch {
    // Best-effort: never let filter maintenance break generation.
  }
}

function vaultFilter(moduleRoot: string): string {
  return path.join(moduleRoot, 'src', 'main', 'content', 'META-INF', 'vault', 'filter.xml');
}

function jcrPathOf(absoluteDir: string, moduleRoot: string): string {
  const jcrRoot = path.join(moduleRoot, 'src', 'main', 'content', 'jcr_root');
  const relative = path.relative(jcrRoot, absoluteDir).split(path.sep).join('/');
  return `/${relative}`;
}

function patchFilter(file: string, requiredRoots: string[]): void {
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch {
    content = '';
  }
  const existing = [...content.matchAll(/root=["']([^"']+)["']/g)].map((match) => match[1]);
  const covered = (root: string): boolean => existing.some((rule) => root === rule || root.startsWith(`${rule}/`));
  const missing = requiredRoots.filter((root) => !covered(root));
  if (!missing.length && content.includes('</workspaceFilter>')) return;

  const rules = missing.map((root) => `    <filter root="${root}"/>`).join('\n');
  const next = content.includes('</workspaceFilter>')
    ? content.replace('</workspaceFilter>', `${rules}\n</workspaceFilter>`)
    : `<?xml version="1.0" encoding="UTF-8"?>\n<workspaceFilter version="1.0">\n${rules}\n</workspaceFilter>\n`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.filter.xml.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(temporary, next, 'utf-8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
