/**
 * Safe file operations with directory creation and conflict detection.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface WriteResult {
  file: string;
  action: 'created' | 'updated' | 'skipped';
  reason?: string;
}

/**
 * Write a file, creating parent directories as needed.
 * Returns the action taken.
 */
export function writeFile(filePath: string, content: string): WriteResult {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const action: WriteResult['action'] = fs.existsSync(filePath) ? 'updated' : 'created';
  fs.writeFileSync(filePath, content, 'utf-8');

  return { file: filePath, action };
}

/**
 * Write a file only if it doesn't already exist (non-destructive).
 */
export function writeFileIfNew(filePath: string, content: string): WriteResult {
  if (fs.existsSync(filePath)) {
    return { file: filePath, action: 'skipped', reason: 'File already exists' };
  }
  return writeFile(filePath, content);
}

/**
 * Write a file, but skip if the on-disk version was manually modified
 * (hash doesn't match the manifest).
 */
export function writeFileManifestAware(
  filePath: string,
  content: string,
  manifestHash: string | undefined,
): WriteResult {
  if (fs.existsSync(filePath)) {
    if (manifestHash) {
      const currentHash = hashFile(filePath);
      if (currentHash !== manifestHash) {
        return {
          file: filePath,
          action: 'skipped',
          reason: 'File was manually modified — skipping to preserve changes',
        };
      }
    }
  }
  return writeFile(filePath, content);
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
}

export function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return hashContent(content);
}
