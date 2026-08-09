import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getTemplateDirectory } from '../utils/templateEngine';

export interface TemplateRegistryEntry {
  name: string;
  sha256: string;
  bytes: number;
}

export interface TemplateRegistry {
  schemaVersion: 1;
  templateSetVersion: string;
  entries: TemplateRegistryEntry[];
  digest: string;
}

export function getTemplateRegistry(): TemplateRegistry {
  const directory = getTemplateDirectory();
  const entries = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.hbs'))
    .sort()
    .map((name) => {
      const content = fs.readFileSync(path.join(directory, name));
      return { name, sha256: sha256(content), bytes: content.byteLength };
    });
  return {
    schemaVersion: 1,
    templateSetVersion: '2.0.0',
    entries,
    digest: sha256(Buffer.from(entries.map((entry) => `${entry.name}:${entry.sha256}`).join('\n'))),
  };
}

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
