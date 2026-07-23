import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config/loader';
import { parseAemCloudProject } from '../scanner/projectDetector';
import { loadManifest } from '../utils/manifest';
import { runDoctor } from './doctor';
import { getTemplateRegistry } from './templateRegistry';

export interface SupportBundle {
  schemaVersion: 1;
  generatedAt: string;
  extensionVersion: string;
  runtime: { platform: string; architecture: string; node: string };
  project: { artifactId: string; groupId: string; version: string; modules: string[] } | null;
  config: Record<string, unknown> | null;
  doctor: ReturnType<typeof runDoctor>;
  manifest: ReturnType<typeof loadManifest>;
  templates: ReturnType<typeof getTemplateRegistry>;
}

export function createSupportBundle(projectRoot: string): SupportBundle {
  const project = parseAemCloudProject(projectRoot);
  let config: Record<string, unknown> | null = null;
  try {
    config = redact(loadConfig(projectRoot)) as Record<string, unknown>;
  } catch {
    // Cloud Doctor contains the safe parse error.
  }
  const doctor = runDoctor(projectRoot);
  doctor.projectRoot = '<project-root>';
  if (doctor.project) doctor.project = { ...doctor.project, root: '<project-root>' };
  doctor.findings = doctor.findings.map((finding) => ({
    ...finding,
    file: finding.file ? redactPath(projectRoot, finding.file) : undefined,
  }));
  if (doctor.scan) {
    doctor.scan.components = doctor.scan.components.map((component) => ({
      ...component,
      sourcePath: redactPath(projectRoot, component.sourcePath),
    }));
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    extensionVersion: '2.0.0',
    runtime: { platform: process.platform, architecture: process.arch, node: process.version },
    project: project
      ? {
          artifactId: project.artifactId,
          groupId: project.groupId,
          version: project.version,
          modules: project.modules,
        }
      : null,
    config,
    doctor,
    manifest: loadManifest(projectRoot),
    templates: getTemplateRegistry(),
  };
}

export function writeSupportBundle(projectRoot: string, outputFile: string): void {
  const output = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(createSupportBundle(projectRoot), null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

function redact(value: unknown, key = ''): unknown {
  if (/password|secret|token|credential|private.?key/i.test(key)) return '<redacted>';
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        redact(child, childKey),
      ]),
    );
  }
  return value;
}

function redactPath(projectRoot: string, file: string): string {
  const absolute = path.isAbsolute(file) ? path.resolve(file) : path.resolve(projectRoot, file);
  const relative = path.relative(path.resolve(projectRoot), absolute);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? '<external-path>'
    : relative.replace(/\\/g, '/');
}
