import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AuditComponent, DuplicateMatch } from './types';

const HASHABLE_PATTERNS = ['.content.xml', '.html', '.js', '.css', '.less', '.scss', '.json'];

export function hashComponentFiles(componentDir: string): Map<string, string> {
  const hashes = new Map<string, string>();
  collectHashes(componentDir, componentDir, hashes);
  return hashes;
}

function collectHashes(baseDir: string, dir: string, hashes: Map<string, string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectHashes(baseDir, full, hashes);
    } else if (HASHABLE_PATTERNS.some((p) => entry.name.endsWith(p))) {
      const relative = path.relative(baseDir, full);
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const normalized = content.replace(/\r\n/g, '\n').trim();
        hashes.set(relative, crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16));
      } catch {
        // skip unreadable files
      }
    }
  }
}

export function detectDuplicates(
  components: AuditComponent[],
  threshold: number,
): DuplicateMatch[] {
  const byLeafName = new Map<string, AuditComponent[]>();
  for (const comp of components) {
    const leaf = comp.name.includes('/') ? comp.name.split('/').pop()! : comp.name;
    const group = byLeafName.get(leaf) ?? [];
    group.push(comp);
    byLeafName.set(leaf, group);
  }

  const duplicates: DuplicateMatch[] = [];
  for (const [, group] of byLeafName) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const result = comparePair(group[i], group[j]);
        if (result.similarity >= threshold) {
          duplicates.push(result);
        }
      }
    }
  }

  duplicates.sort((a, b) => b.similarity - a.similarity);
  return duplicates;
}

function comparePair(a: AuditComponent, b: AuditComponent): DuplicateMatch {
  const allFiles = new Set([...a.fileHashes.keys(), ...b.fileHashes.keys()]);
  if (allFiles.size === 0) {
    return {
      componentA: a.resourceType,
      componentB: b.resourceType,
      siteA: a.site,
      siteB: b.site,
      similarity: 100,
      matchingFiles: [],
      differingFiles: [],
      recommendation: 'merge',
    };
  }

  const matching: string[] = [];
  const differing: string[] = [];

  for (const file of allFiles) {
    const hashA = a.fileHashes.get(file);
    const hashB = b.fileHashes.get(file);
    if (hashA && hashB && hashA === hashB) {
      matching.push(file);
    } else {
      differing.push(file);
    }
  }

  const similarity = Math.round((matching.length / allFiles.size) * 100);
  const recommendation: DuplicateMatch['recommendation'] =
    similarity === 100 ? 'remove-duplicate' : similarity >= 80 ? 'merge' : 'keep-separate';

  return {
    componentA: a.resourceType,
    componentB: b.resourceType,
    siteA: a.site,
    siteB: b.site,
    similarity,
    matchingFiles: matching,
    differingFiles: differing,
    recommendation,
  };
}
