import type { DoctorFinding, DoctorReport } from './doctor';

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: unknown[];
}

export function doctorReportToSarif(report: DoctorReport): SarifLog {
  const rules = [...new Set(report.findings.map((finding) => finding.ruleId))].map((ruleId) => ({
    id: ruleId,
    name: ruleId.replace(/[^a-zA-Z0-9]+/g, '_'),
    shortDescription: {
      text: report.findings.find((finding) => finding.ruleId === ruleId)?.title ?? ruleId,
    },
  }));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'AEM Component Catalog Cloud Doctor',
            semanticVersion: '2.0.0',
            informationUri: 'https://github.com/pidilite/aem-component-catalog-vs-extension',
            rules,
          },
        },
        results: report.findings.map((finding) => findingToResult(report.projectRoot, finding)),
      },
    ],
  };
}

function findingToResult(projectRoot: string, finding: DoctorFinding): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ruleId: finding.ruleId,
    level: finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'note',
    message: { text: `${finding.title}: ${finding.message}` },
    properties: {
      component: finding.component,
      recommendation: finding.recommendation,
    },
  };
  if (finding.file) {
    const relative = finding.file.startsWith(projectRoot)
      ? finding.file.slice(projectRoot.length).replace(/^[/\\]/, '')
      : finding.file;
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: relative.replace(/\\/g, '/') },
          region: finding.line ? { startLine: finding.line } : undefined,
        },
      },
    ];
  }
  return result;
}
