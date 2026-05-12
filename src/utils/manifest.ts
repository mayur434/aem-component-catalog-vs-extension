/**
 * Manifest tracking — records which files were generated and their hashes.
 * Used by Update command to detect manual modifications.
 */
import * as fs from 'fs';
import * as path from 'path';
import { hashContent } from './fileOps';

const MANIFEST_FILE = '.clgen-manifest.json';

export interface ManifestEntry {
  hash: string;
  generatedAt: string;
}

export interface Manifest {
  generatedAt: string;
  configHash: string;
  files: Record<string, ManifestEntry>;
}

export function manifestPath(projectRoot: string): string {
  return path.join(projectRoot, MANIFEST_FILE);
}

export function loadManifest(projectRoot: string): Manifest | null {
  const mf = manifestPath(projectRoot);
  if (!fs.existsSync(mf)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(mf, 'utf-8'));
}

export function saveManifest(projectRoot: string, manifest: Manifest): void {
  const mf = manifestPath(projectRoot);
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

export function createManifest(configHash: string): Manifest {
  return {
    generatedAt: new Date().toISOString(),
    configHash,
    files: {},
  };
}

export function addToManifest(manifest: Manifest, filePath: string, content: string): void {
  manifest.files[filePath] = {
    hash: hashContent(content),
    generatedAt: new Date().toISOString(),
  };
}
