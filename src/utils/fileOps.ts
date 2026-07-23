import * as crypto from 'crypto';
import * as fs from 'fs';

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

export function hashFile(filePath: string): string {
  return hashContent(fs.readFileSync(filePath, 'utf-8'));
}
