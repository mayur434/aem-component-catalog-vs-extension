/** Portable, versioned ownership manifest for generated artifacts. */
import * as fs from 'fs';
import * as path from 'path';
import type { ArtifactKind } from '../core/artifact';
import { hashContent } from './fileOps';
import { safeRelativePath } from './pathSecurity';

export const MANIFEST_FILE = '.aem-catalog-manifest.json';
const LEGACY_MANIFEST_FILE = '.clgen-manifest.json';

export interface ManifestEntry {
  hash: string;
  generatedAt: string;
  kind: ArtifactKind;
}

export interface Manifest {
  schemaVersion: 2;
  generatorVersion: string;
  generatedAt: string;
  configHash: string;
  files: Record<string, ManifestEntry>;
}

export function manifestPath(projectRoot: string): string {
  return path.join(projectRoot, MANIFEST_FILE);
}

export function loadManifest(projectRoot: string): Manifest | null {
  const current = manifestPath(projectRoot);
  if (fs.existsSync(current)) {
    const parsed = JSON.parse(fs.readFileSync(current, 'utf-8')) as Manifest;
    return parsed.schemaVersion === 2 ? parsed : null;
  }

  const legacy = path.join(projectRoot, LEGACY_MANIFEST_FILE);
  if (!fs.existsSync(legacy)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(legacy, 'utf-8')) as {
    generatedAt?: string;
    configHash?: string;
    files?: Record<string, { hash: string; generatedAt?: string }>;
  };
  const manifest = createManifest(parsed.configHash ?? 'legacy');
  manifest.generatedAt = parsed.generatedAt ?? manifest.generatedAt;
  for (const [file, entry] of Object.entries(parsed.files ?? {})) {
    try {
      const relative = path.isAbsolute(file) ? safeRelativePath(projectRoot, file) : file.replace(/\\/g, '/');
      manifest.files[relative] = {
        hash: entry.hash,
        generatedAt: entry.generatedAt ?? manifest.generatedAt,
        kind: inferKind(relative),
      };
    } catch {
      // Ignore legacy entries that point outside the project.
    }
  }
  return manifest;
}

export function saveManifest(projectRoot: string, manifest: Manifest): void {
  atomicWrite(manifestPath(projectRoot), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function createManifest(configHash: string): Manifest {
  return {
    schemaVersion: 2,
    generatorVersion: '2.0.0',
    generatedAt: new Date().toISOString(),
    configHash,
    files: {},
  };
}

export function addToManifest(
  manifest: Manifest,
  projectRoot: string,
  filePath: string,
  content: string,
  kind: ArtifactKind,
): void {
  manifest.files[safeRelativePath(projectRoot, filePath)] = {
    hash: hashContent(content),
    generatedAt: new Date().toISOString(),
    kind,
  };
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

function inferKind(file: string): ArtifactKind {
  if (file.endsWith('.java')) return 'java';
  if (file.endsWith('.html')) return 'htl';
  if (file.endsWith('.cfg.json')) return 'osgi';
  if (file.includes('clientlib')) return 'clientlib';
  return 'content';
}
