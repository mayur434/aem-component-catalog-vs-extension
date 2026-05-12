/**
 * Detect AEM project structure from a workspace root.
 * Reads the reactor POM to extract artifactId, groupId, version, and modules.
 */
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

export type AemProjectType = 'cloud' | 'ams';

export interface ProjectInfo {
  root: string;
  artifactId: string;
  groupId: string;
  version: string;
  javaPackage: string;
  modules: string[];
  /** Detected project type — AEMaaCS ('cloud') or AEM AMS ('ams') */
  projectType: AemProjectType;
  /** Java compiler target version */
  javaVersion: string;
}

/**
 * Scan a directory for a reactor pom.xml and extract project metadata.
 */
export function detectProject(workspaceRoot: string): ProjectInfo | null {
  // Look for pom.xml in root or one level down
  const candidates = [workspaceRoot];
  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push(path.join(workspaceRoot, entry.name));
      }
    }
  } catch {
    // ignore
  }

  for (const dir of candidates) {
    const pomFile = path.join(dir, 'pom.xml');
    if (!fs.existsSync(pomFile)) { continue; }
    const info = parsePom(dir, pomFile);
    if (info && info.modules.length > 0) {
      return info;
    }
  }

  return null;
}

/**
 * Find all AEM projects in a workspace (multi-project support).
 */
export function detectAllProjects(workspaceRoot: string): ProjectInfo[] {
  const results: ProjectInfo[] = [];
  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) { continue; }
      const dir = path.join(workspaceRoot, entry.name);
      const pomFile = path.join(dir, 'pom.xml');
      if (!fs.existsSync(pomFile)) { continue; }
      const info = parsePom(dir, pomFile);
      if (info && info.modules.length > 0) {
        results.push(info);
      }
    }
  } catch {
    // ignore
  }
  // Also check workspace root itself
  const rootPom = path.join(workspaceRoot, 'pom.xml');
  if (fs.existsSync(rootPom)) {
    const info = parsePom(workspaceRoot, rootPom);
    if (info && info.modules.length > 0 && !results.find(r => r.root === workspaceRoot)) {
      results.push(info);
    }
  }
  return results;
}

function parsePom(dir: string, pomFile: string): ProjectInfo | null {
  try {
    const xml = fs.readFileSync(pomFile, 'utf-8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const doc = parser.parse(xml);
    const project = doc.project;
    if (!project) { return null; }

    const artifactId = project.artifactId || '';
    const groupId = project.groupId || project.parent?.groupId || '';
    const version = project.version || project.parent?.version || '';
    const packaging = project.packaging || 'jar';

    // Only reactor (pom packaging) with modules
    if (packaging !== 'pom') { return null; }

    let modules: string[] = [];
    if (project.modules?.module) {
      modules = Array.isArray(project.modules.module)
        ? project.modules.module
        : [project.modules.module];
    }

    // Detect java package from existing source files
    const javaPackage = detectJavaPackage(dir, artifactId, groupId);

    // Detect project type: AEMaaCS vs AMS
    const projectType = detectProjectType(dir, xml);

    // Detect Java version
    const javaVersion = detectJavaVersion(xml);

    return { root: dir, artifactId, groupId, version, javaPackage, modules, projectType, javaVersion };
  } catch {
    return null;
  }
}

/**
 * Detect whether this is an AEMaaCS or AEM AMS project.
 * Heuristics:
 *  - aem-sdk-api dependency → cloud
 *  - aemanalyser-maven-plugin → cloud
 *  - ui.apps.structure module → cloud
 *  - uber-jar dependency → ams
 *  - otherwise → ams (safer default)
 */
function detectProjectType(projectRoot: string, pomXml: string): AemProjectType {
  // Check for Cloud SDK indicators
  if (pomXml.includes('aem-sdk-api') || pomXml.includes('aemanalyser')) {
    return 'cloud';
  }
  if (fs.existsSync(path.join(projectRoot, 'ui.apps.structure'))) {
    return 'cloud';
  }
  return 'ams';
}

/**
 * Detect Java compiler target version from POM.
 */
function detectJavaVersion(pomXml: string): string {
  // Try maven.compiler.source/target properties
  const sourceMatch = pomXml.match(/<source>([\d.]+)<\/source>/);
  if (sourceMatch) { return sourceMatch[1]; }

  // Try maven.compiler.release
  const releaseMatch = pomXml.match(/<release>(\d+)<\/release>/);
  if (releaseMatch) { return releaseMatch[1]; }

  // Try java.version property
  const javaVerMatch = pomXml.match(/<java\.version>([\d.]+)<\/java\.version>/);
  if (javaVerMatch) { return javaVerMatch[1]; }

  return '11'; // default for modern AEM
}

function detectJavaPackage(projectRoot: string, artifactId: string, groupId: string): string {
  const coreJava = path.join(projectRoot, 'core', 'src', 'main', 'java');
  if (!fs.existsSync(coreJava)) {
    return groupId ? `${groupId}.core.servlets` : `com.${artifactId.replace(/-/g, '.')}.core.servlets`;
  }

  // Walk the java source tree to find an existing package
  const pkg = walkForPackage(coreJava, '');
  if (pkg) {
    return pkg;
  }

  return groupId ? `${groupId}.core.servlets` : `com.${artifactId.replace(/-/g, '.')}.core.servlets`;
}

function walkForPackage(baseDir: string, prefix: string): string | null {
  const entries = fs.readdirSync(path.join(baseDir, prefix), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.java')) {
      // Read first line to get package declaration
      const content = fs.readFileSync(path.join(baseDir, prefix, entry.name), 'utf-8');
      const match = content.match(/^package\s+([\w.]+);/m);
      if (match) {
        // Return the base package (strip trailing .servlets, .models, etc.)
        const pkg = match[1];
        const parts = pkg.split('.');
        // Find the "core" segment and return up to it
        const coreIdx = parts.indexOf('core');
        if (coreIdx >= 0) {
          return parts.slice(0, coreIdx + 1).join('.') + '.servlets';
        }
        return pkg;
      }
    }
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const result = walkForPackage(baseDir, path.join(prefix, entry.name));
      if (result) { return result; }
    }
  }
  return null;
}
