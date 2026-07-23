#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { getDefaults } from './config/defaults';
import { configExists, configPath, loadConfig, saveConfig } from './config/loader';
import { formatDoctorReport, runDoctor } from './core/doctor';
import {
  applyGenerationPlan,
  buildGenerationPlan,
  formatPlan,
  rollbackLastGeneration,
} from './core/generation';
import { doctorReportToSarif } from './core/sarif';
import { defaultPolicy } from './core/policy';
import { createSupportBundle } from './core/supportBundle';
import { getTemplateRegistry } from './core/templateRegistry';
import { scanComponents } from './scanner/componentScanner';
import { detectProject, parseAemCloudProject } from './scanner/projectDetector';

interface Arguments {
  command: string;
  project?: string;
  policy?: string;
  format: 'pretty' | 'json' | 'sarif' | 'csv';
  output?: string;
  yes: boolean;
  force: boolean;
  help: boolean;
}

export function main(argv = process.argv.slice(2)): number {
  try {
    const args = parseArguments(argv);
    if (args.help || !args.command) {
      process.stdout.write(help());
      return 0;
    }
    if (args.command === 'version' || args.command === '--version') {
      process.stdout.write('aem-catalog 2.0.0\n');
      return 0;
    }
    if (args.command === 'templates') {
      writeOutput(JSON.stringify(getTemplateRegistry(), null, 2), args.output);
      return 0;
    }
    const projectRoot = resolveProjectRoot(args.project);
    switch (args.command) {
      case 'init':
        return initialize(projectRoot, args);
      case 'doctor':
      case 'validate':
        return doctor(projectRoot, args);
      case 'scan':
        return scan(projectRoot, args);
      case 'plan':
        return plan(projectRoot, args);
      case 'generate':
      case 'apply':
        return generate(projectRoot, args);
      case 'rollback':
        return rollback(projectRoot, args);
      case 'support':
        writeOutput(JSON.stringify(createSupportBundle(projectRoot), null, 2), args.output);
        return 0;
      default:
        throw new Error(`Unknown command “${args.command}”.\n\n${help()}`);
    }
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

function initialize(projectRoot: string, args: Arguments): number {
  if (!args.yes) {
    throw new Error('Initialization is non-interactive. Review the defaults, then pass --yes.');
  }
  if (configExists(projectRoot) && !args.force) {
    throw new Error(`${configPath(projectRoot)} already exists. Pass --force to replace it.`);
  }

  const project = parseAemCloudProject(projectRoot);
  if (!project) throw new Error(`No AEM as a Cloud Service project found at ${projectRoot}`);
  const config = getDefaults(project.artifactId);
  config.output.servletPackage = project.javaPackage;
  config.hero.badge = project.artifactId;
  config.hero.titlePrefix = project.artifactId;
  saveConfig(projectRoot, config);

  const policyFile = path.join(projectRoot, config.governance.policyFile);
  if (!fs.existsSync(policyFile) || args.force) {
    writeAtomic(policyFile, `${JSON.stringify(defaultPolicy(), null, 2)}\n`, 0o644);
  }
  writeOutput(
    `Initialized AEMaaCS catalog configuration at ${configPath(projectRoot)} and policy at ${policyFile}`,
    args.output,
  );
  return 0;
}

function doctor(projectRoot: string, args: Arguments): number {
  if (args.format === 'csv') throw new Error('Doctor supports pretty, JSON, or SARIF output.');
  const report = runDoctor(projectRoot, { policyFile: args.policy });
  const content =
    args.format === 'sarif'
      ? JSON.stringify(doctorReportToSarif(report), null, 2)
      : args.format === 'json'
        ? JSON.stringify(report, null, 2)
        : formatDoctorReport(report);
  writeOutput(content, args.output);
  return report.summary.passed ? 0 : 1;
}

function scan(projectRoot: string, args: Arguments): number {
  if (args.format === 'sarif') throw new Error('Scan supports pretty, JSON, or CSV output.');
  const result = scanComponents(projectRoot, loadConfig(projectRoot));
  if (args.format === 'json') {
    writeOutput(JSON.stringify(result, null, 2), args.output);
  } else if (args.format === 'csv') {
    const rows = [
      [
        'resourceType',
        'title',
        'group',
        'owner',
        'status',
        'version',
        'qualityScore',
        'dialogFields',
        'modelClass',
        'exporter',
        'usageCount',
      ],
      ...result.components.map((component) => [
        component.resourceType,
        component.title,
        component.group,
        component.owner,
        component.status,
        component.version,
        component.quality.score,
        component.dialogFields.length,
        component.modelClass,
        component.exporter,
        component.usageCount,
      ]),
    ];
    writeOutput(rows.map((row) => row.map(csvCell).join(',')).join('\n'), args.output);
  } else {
    const rows = [
      'QUALITY  STATUS       OWNER                RESOURCE TYPE',
      ...result.components.map(
        (component) =>
          `${String(component.quality.score).padStart(3)}/100  ${(component.status || 'unset').padEnd(12)} ${(component.owner || 'unowned').padEnd(20)} ${component.resourceType}`,
      ),
      '',
      `${result.total} components · ${Object.keys(result.groups).length} groups · average quality ${result.averageQualityScore}/100`,
    ];
    writeOutput(rows.join('\n'), args.output);
  }
  return 0;
}

function plan(projectRoot: string, args: Arguments): number {
  if (args.format === 'sarif' || args.format === 'csv') {
    throw new Error('Plan supports pretty or JSON output.');
  }
  const generationPlan = buildGenerationPlan(projectRoot, loadConfig(projectRoot));
  if (args.format === 'json') {
    writeOutput(
      JSON.stringify(
        {
          ...generationPlan,
          previousManifest: undefined,
          items: generationPlan.items.map(({ content: _content, ...item }) => item),
        },
        null,
        2,
      ),
      args.output,
    );
  } else {
    writeOutput(formatPlan(generationPlan), args.output);
  }
  return generationPlan.items.some((item) => item.status === 'conflict') ? 1 : 0;
}

function generate(projectRoot: string, args: Arguments): number {
  if (!args.yes) {
    throw new Error('Generation is non-interactive. Review `aem-catalog plan`, then pass --yes to apply.');
  }
  const report = runDoctor(projectRoot, { policyFile: args.policy });
  if (!report.summary.passed && !args.force) {
    process.stderr.write(`${formatDoctorReport(report)}\n`);
    throw new Error('Cloud Doctor reported errors. Resolve them or explicitly pass --force.');
  }
  const generationPlan = buildGenerationPlan(projectRoot, loadConfig(projectRoot));
  const result = applyGenerationPlan(generationPlan, {
    overwriteConflicts: args.force,
    actor: 'cli',
  });
  writeOutput(JSON.stringify(result, null, 2), args.output);
  return result.skipped ? 1 : 0;
}

function rollback(projectRoot: string, args: Arguments): number {
  if (!args.yes) {
    throw new Error('Rollback requires --yes because it restores the previous generated state.');
  }
  const transactionId = rollbackLastGeneration(projectRoot, 'cli');
  writeOutput(`Rolled back generation transaction ${transactionId}`, args.output);
  return 0;
}

function parseArguments(argv: string[]): Arguments {
  const result: Arguments = {
    command: '',
    format: 'pretty',
    yes: false,
    force: false,
    help: false,
  };
  const values = [...argv];
  if (values[0] && !values[0].startsWith('-')) result.command = values.shift() ?? '';
  while (values.length) {
    const option = values.shift();
    switch (option) {
      case '--project':
      case '-p':
        result.project = requiredValue(option, values.shift());
        break;
      case '--policy':
        result.policy = requiredValue(option, values.shift());
        break;
      case '--format': {
        const format = requiredValue(option, values.shift());
        if (!['pretty', 'json', 'sarif', 'csv'].includes(format))
          throw new Error(`Unsupported format: ${format}`);
        result.format = format as Arguments['format'];
        break;
      }
      case '--output':
      case '-o':
        result.output = requiredValue(option, values.shift());
        break;
      case '--yes':
      case '-y':
        result.yes = true;
        break;
      case '--force':
        result.force = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${String(option)}`);
    }
  }
  return result;
}

function resolveProjectRoot(requested?: string): string {
  const candidate = path.resolve(requested ?? process.cwd());
  const direct = parseAemCloudProject(candidate);
  const project = direct ?? detectProject(candidate);
  if (!project) throw new Error(`No AEM as a Cloud Service project found at or below ${candidate}`);
  return project.root;
}

function writeOutput(content: string, output?: string): void {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  if (!output) {
    process.stdout.write(normalized);
    return;
  }
  const file = path.resolve(output);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, normalized, 'utf-8');
}

function writeAtomic(file: string, content: string, mode: number): void {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf-8', mode });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function requiredValue(option: string | undefined, value: string | undefined): string {
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
  return value;
}

function help(): string {
  return `AEM Component Catalog Enterprise CLI 2.0.0

Usage: aem-catalog <command> [options]

Commands:
  init         Create v2 configuration and policy defaults (requires --yes)
  doctor       Validate AEMaaCS structure, governance, and generated drift
  scan         Inventory components and quality metadata
  plan         Preview every generated artifact and conflict
  generate     Apply a reviewed plan transactionally (requires --yes)
  rollback     Restore the last generation transaction (requires --yes)
  support      Export a redacted diagnostic bundle as JSON
  templates    Print the built-in template registry and SHA-256 digest
  version      Print the CLI version

Options:
  -p, --project <path>    AEMaaCS project root or containing workspace
      --policy <path>     Workspace-relative policy file
      --format <format>   pretty, json, sarif, or csv (scan)
  -o, --output <file>     Write the report to a file
  -y, --yes               Confirm initialization, generation, or rollback
      --force             Replace config, overwrite conflicts, or bypass policy errors
  -h, --help              Show this help
`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

if (require.main === module) {
  process.exitCode = main();
}
