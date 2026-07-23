/** Detect AEM as a Cloud Service Maven reactor projects. */
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

export interface ProjectInfo {
  root: string;
  artifactId: string;
  groupId: string;
  version: string;
  javaPackage: string;
  modules: string[];
  platform: 'aemaacs';
  javaVersion: string;
}

interface PomProject {
  artifactId?: string;
  groupId?: string;
  version?: string;
  packaging?: string;
  parent?: { groupId?: string; version?: string };
  modules?: { module?: string | string[] };
}

export function detectProject(workspaceRoot: string): ProjectInfo | null {
  return detectAllProjects(workspaceRoot)[0] ?? null;
}

/** Find AEMaaCS reactors at the workspace root or one directory below it. */
export function detectAllProjects(workspaceRoot: string): ProjectInfo[] {
  const candidates = new Set<string>([path.resolve(workspaceRoot)]);
  try {
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        candidates.add(path.resolve(workspaceRoot, entry.name));
      }
    }
  } catch {
    return [];
  }

  return [...candidates]
    .map((root) => parseAemCloudProject(root))
    .filter((project): project is ProjectInfo => project !== null)
    .sort((a, b) => a.root.localeCompare(b.root));
}

export function parseAemCloudProject(projectRoot: string): ProjectInfo | null {
  const pomFile = path.join(projectRoot, 'pom.xml');
  if (!fs.existsSync(pomFile)) {
    return null;
  }

  try {
    const xml = fs.readFileSync(pomFile, 'utf-8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const project = parser.parse(xml)?.project as PomProject | undefined;
    if (!project || (project.packaging ?? 'jar') !== 'pom') {
      return null;
    }

    const moduleValue = project.modules?.module;
    const modules = moduleValue ? (Array.isArray(moduleValue) ? moduleValue : [moduleValue]) : [];
    if (modules.length === 0 || !isAemCloudReactor(projectRoot, xml, modules)) {
      return null;
    }

    const artifactId = String(project.artifactId ?? '');
    const groupId = String(project.groupId ?? project.parent?.groupId ?? '');
    return {
      root: projectRoot,
      artifactId,
      groupId,
      version: String(project.version ?? project.parent?.version ?? ''),
      javaPackage: detectJavaPackage(projectRoot, artifactId, groupId),
      modules: modules.map(String),
      platform: 'aemaacs',
      javaVersion: detectJavaVersion(xml),
    };
  } catch {
    return null;
  }
}

function isAemCloudReactor(projectRoot: string, pomXml: string, modules: string[]): boolean {
  const hasCloudApi = pomXml.includes('aem-sdk-api') || pomXml.includes('aemanalyser-maven-plugin');
  const hasCloudStructure =
    modules.includes('ui.config') &&
    modules.includes('all') &&
    (modules.includes('dispatcher') ||
      modules.includes('dispatcher.cloud') ||
      fs.existsSync(path.join(projectRoot, 'dispatcher')) ||
      fs.existsSync(path.join(projectRoot, 'dispatcher.cloud')));
  const explicitlyLegacy = pomXml.includes('uber-jar') && !hasCloudApi;
  return !explicitlyLegacy && (hasCloudApi || hasCloudStructure);
}

function detectJavaVersion(pomXml: string): string {
  for (const pattern of [
    /<maven\.compiler\.release>([\d.]+)<\/maven\.compiler\.release>/,
    /<maven\.compiler\.source>([\d.]+)<\/maven\.compiler\.source>/,
    /<release>([\d.]+)<\/release>/,
    /<source>([\d.]+)<\/source>/,
    /<java\.version>([\d.]+)<\/java\.version>/,
  ]) {
    const match = pomXml.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return '11';
}

function detectJavaPackage(projectRoot: string, artifactId: string, groupId: string): string {
  const coreJava = path.join(projectRoot, 'core', 'src', 'main', 'java');
  const discovered = fs.existsSync(coreJava) ? walkForPackage(coreJava) : null;
  if (discovered) {
    const parts = discovered.split('.');
    const coreIndex = parts.indexOf('core');
    const base = coreIndex >= 0 ? parts.slice(0, coreIndex + 1).join('.') : discovered;
    return base.endsWith('.servlets') ? base : `${base}.servlets`;
  }
  return groupId
    ? `${groupId}.core.servlets`
    : `com.${artifactId.replace(/[^a-zA-Z0-9]+/g, '.')}.core.servlets`;
}

function walkForPackage(directory: string): string | null {
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const result = walkForPackage(absolute);
        if (result) {
          return result;
        }
      } else if (entry.name.endsWith('.java')) {
        const match = fs.readFileSync(absolute, 'utf-8').match(/^package\s+([\w.]+);/m);
        if (match) {
          return match[1];
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}
