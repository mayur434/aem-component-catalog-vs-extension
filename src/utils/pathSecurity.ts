import * as fs from 'fs';
import * as path from 'path';

export function isPathInside(parent: string, candidate: string): boolean {
  const parentPath = resolveExistingPath(parent);
  const candidatePath = resolveExistingPath(candidate);
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export function assertPathInside(parent: string, candidate: string, label = 'Path'): string {
  const resolved = path.resolve(candidate);
  if (!isPathInside(parent, resolved)) {
    throw new Error(`${label} escapes the AEM project root: ${candidate}`);
  }
  return resolved;
}

export function resolveExistingPath(candidate: string): string {
  const suffix: string[] = [];
  let existing = path.resolve(candidate);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(candidate);
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.join(fs.realpathSync(existing), ...suffix);
  } catch {
    return path.resolve(candidate);
  }
}

export function safeRelativePath(projectRoot: string, candidate: string): string {
  const absolute = assertPathInside(projectRoot, candidate);
  return path.relative(path.resolve(projectRoot), absolute).split(path.sep).join('/');
}
