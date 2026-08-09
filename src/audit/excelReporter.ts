import ExcelJS from 'exceljs';
import type { AuditResult, DuplicateMatch } from './types';

// ─── DEPT Brand — Black & White ─────────────────────────────────
const BRAND = {
  black: 'FF000000',
  darkGray: 'FF333333',
  midDark: 'FF555555',
  white: 'FFFFFFFF',
  offWhite: 'FFF7F7F7',
  lightGray: 'FFEEEEEE',
  midGray: 'FFDDDDDD',
  textGray: 'FF888888',
  textDark: 'FF222222',
};

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: BRAND.black },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: BRAND.white },
  size: 10,
  name: 'Calibri',
};
const SUB_HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: BRAND.darkGray },
};
const SUB_HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: BRAND.white },
  size: 10,
  name: 'Calibri',
};
const ROW_EVEN_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: BRAND.offWhite },
};
const ROW_ODD_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: BRAND.white },
};
const SECTION_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: BRAND.lightGray },
};
const CELL_BORDER: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: BRAND.midGray } },
};
const BODY_FONT: Partial<ExcelJS.Font> = {
  size: 10,
  name: 'Calibri',
  color: { argb: BRAND.textDark },
};
const MUTED_FONT: Partial<ExcelJS.Font> = {
  size: 9,
  name: 'Calibri',
  color: { argb: BRAND.textGray },
};

const CLASSIFICATION_FILLS: Record<string, string> = {
  ootb: BRAND.lightGray,
  proxied: 'FFCCCCCC',
  'proxied-customized': BRAND.midDark,
  custom: BRAND.black,
};
const CLASSIFICATION_FONTS: Record<string, string> = {
  ootb: BRAND.textDark,
  proxied: BRAND.textDark,
  'proxied-customized': BRAND.white,
  custom: BRAND.white,
};
const TAB_COLORS: Record<string, { argb: string }> = {
  cover: { argb: '000000' },
  summary: { argb: '333333' },
  inventory: { argb: '555555' },
  classification: { argb: '777777' },
  duplicates: { argb: '999999' },
  usage: { argb: 'AAAAAA' },
  crossSite: { argb: '666666' },
  recommendations: { argb: '444444' },
};

export async function generateExcelReport(result: AuditResult, outputPath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DEPT — AEM Component Audit';
  workbook.company = 'DEPT';
  workbook.created = new Date();
  workbook.modified = new Date();

  addCoverSheet(workbook, result);
  addExecutiveSummary(workbook, result);
  addComponentInventory(workbook, result);
  addClassificationSheet(workbook, result);
  addDuplicateSheet(workbook, result);
  addUsageSheet(workbook, result);
  addCrossSiteSheet(workbook, result);
  addRecommendationsSheet(workbook, result);

  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

// ─── Cover Sheet ─────────────────────────────────────────────────

function addCoverSheet(workbook: ExcelJS.Workbook, result: AuditResult): void {
  const ws = workbook.addWorksheet('Cover', { properties: { tabColor: TAB_COLORS.cover } });
  ws.columns = [{ width: 5 }, { width: 55 }, { width: 30 }, { width: 20 }, { width: 5 }];

  // Brand bar
  for (let r = 1; r <= 3; r++) {
    const row = ws.addRow([]);
    fillRow(row, 1, 5, BRAND.black);
  }

  // DEPT title
  const brandRow = ws.addRow([]);
  fillRow(brandRow, 1, 5, BRAND.black);
  const brandCell = brandRow.getCell(2);
  brandCell.value = 'DEPT';
  brandCell.font = { bold: true, size: 28, color: { argb: BRAND.white }, name: 'Calibri' };
  brandCell.alignment = { vertical: 'middle' };

  const taglineRow = ws.addRow([]);
  fillRow(taglineRow, 1, 5, BRAND.black);
  const tagCell = taglineRow.getCell(2);
  tagCell.value = 'Technology & Digital Transformation';
  tagCell.font = { size: 12, color: { argb: BRAND.textGray }, name: 'Calibri', italic: true };

  for (let r = 0; r < 2; r++) {
    const row = ws.addRow([]);
    fillRow(row, 1, 5, BRAND.black);
  }

  ws.addRow([]);

  // Report title
  const titleRow = ws.addRow([]);
  const titleCell = titleRow.getCell(2);
  titleCell.value = 'AEM Component Tech Audit';
  titleCell.font = { bold: true, size: 24, color: { argb: BRAND.black }, name: 'Calibri' };

  const subtitleRow = ws.addRow([]);
  const subCell = subtitleRow.getCell(2);
  subCell.value = 'Enterprise Component Analysis & Recommendations Report';
  subCell.font = { size: 13, color: { argb: BRAND.textGray }, name: 'Calibri' };

  ws.addRow([]);
  ws.addRow([]);

  // Report metadata
  const metaItems = [
    ['Report Date', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
    ['Generated At', result.generatedAt],
    ['Projects Analyzed', result.projects.length.toString()],
    ['Total Components', result.summary.totalComponents.toString()],
    ['Platforms', [...new Set(result.projects.map((p) => p.platform === 'aemaacs' ? 'AEMaaCS' : 'AEM AMS'))].join(', ')],
  ];

  for (const [label, value] of metaItems) {
    const row = ws.addRow([]);
    const labelCell = row.getCell(2);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 10, color: { argb: BRAND.textGray }, name: 'Calibri' };
    const valCell = row.getCell(3);
    valCell.value = value;
    valCell.font = { size: 10, color: { argb: BRAND.textDark }, name: 'Calibri' };
  }

  ws.addRow([]);

  // Project list
  const projHeaderRow = ws.addRow([]);
  const projHeaderCell = projHeaderRow.getCell(2);
  projHeaderCell.value = 'Projects Included';
  projHeaderCell.font = { bold: true, size: 12, color: { argb: BRAND.black }, name: 'Calibri' };

  for (const project of result.projects) {
    const platform = project.platform === 'aemaacs' ? 'AEMaaCS' : 'AEM AMS';
    const row = ws.addRow([]);
    row.getCell(2).value = `${project.artifactId}`;
    row.getCell(2).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
    row.getCell(3).value = `${platform} — ${project.groupId}:${project.version}`;
    row.getCell(3).font = MUTED_FONT;
  }

  ws.addRow([]);
  ws.addRow([]);

  // Table of contents
  const tocHeader = ws.addRow([]);
  tocHeader.getCell(2).value = 'Report Contents';
  tocHeader.getCell(2).font = { bold: true, size: 12, color: { argb: BRAND.black }, name: 'Calibri' };

  const sheets = [
    ['Executive Summary', 'KPI metrics, classification breakdown, technical analysis'],
    ['Component Inventory', 'Full component matrix with 21 data columns'],
    ['Classification Detail', 'Proxy chain resolution and OOTB mapping'],
    ['Duplicate Analysis', 'Hash-based similarity detection across sites'],
    ['Usage Analysis', 'Component usage from content packages'],
    ['Cross-Site Reuse', 'Cross-site component overlap analysis'],
    ['Recommendations', 'Prioritized action items by impact level'],
  ];
  for (const [name, desc] of sheets) {
    const row = ws.addRow([]);
    row.getCell(2).value = name;
    row.getCell(2).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
    row.getCell(3).value = desc;
    row.getCell(3).font = MUTED_FONT;
  }

  ws.addRow([]);

  // Footer
  const footerRow = ws.addRow([]);
  footerRow.getCell(2).value = 'Confidential — Prepared by DEPT for internal use only';
  footerRow.getCell(2).font = { size: 9, color: { argb: BRAND.textGray }, name: 'Calibri', italic: true };

  setupPrintArea(ws, 5);
}

// ─── Executive Summary ──────────────────────────────────────────

function addExecutiveSummary(workbook: ExcelJS.Workbook, result: AuditResult): void {
  const ws = workbook.addWorksheet('Executive Summary', { properties: { tabColor: TAB_COLORS.summary } });
  ws.columns = [{ width: 38 }, { width: 18 }, { width: 14 }, { width: 28 }, { width: 22 }];

  addSheetBanner(ws, 'Executive Summary', 'AEM Component Tech Audit', 5);

  // Project Details
  addSectionHeader(ws, 'Project Details', 5);
  for (const project of result.projects) {
    const platform = project.platform === 'aemaacs' ? 'AEM as a Cloud Service' : 'AEM AMS (Managed Services)';
    addLabelValueRow(ws, 'Project', project.artifactId);
    addLabelValueRow(ws, 'Platform', platform);
    addLabelValueRow(ws, 'Group ID', project.groupId);
    addLabelValueRow(ws, 'Version', project.version);
    addLabelValueRow(ws, 'Java Version', project.javaVersion);
    ws.addRow([]);
  }

  // KPI Metrics
  addSectionHeader(ws, 'Key Performance Indicators', 5);
  const { summary } = result;

  const kpiRow = ws.addRow(['Total Components', 'Total Sites', 'Duplicate Pairs', 'Unused Components', 'Recommendations']);
  applySubHeaderRow(kpiRow);
  const kpiValRow = ws.addRow([
    summary.totalComponents,
    summary.totalSites,
    summary.duplicatePairs,
    summary.unusedComponents,
    result.recommendations.length,
  ]);
  kpiValRow.font = { bold: true, size: 18, name: 'Calibri', color: { argb: BRAND.black } };
  kpiValRow.alignment = { horizontal: 'center', vertical: 'middle' };
  kpiValRow.height = 32;
  applyZebraRow(kpiValRow, 0);
  ws.addRow([]);

  // Classification Breakdown
  addSectionHeader(ws, 'Classification Breakdown', 5);
  const classHeaderRow = ws.addRow(['Classification', 'Count', '%', 'Assessment']);
  applySubHeaderRow(classHeaderRow);

  let rowIdx = 0;
  for (const [key, count] of Object.entries(summary.byClassification)) {
    const pct = summary.totalComponents > 0 ? Math.round((count / summary.totalComponents) * 100) : 0;
    const assessment = classificationAssessment(key, pct);
    const row = ws.addRow([classificationLabel(key), count, `${pct}%`, assessment]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };
    applyClassificationCell(row.getCell(1), key);
    row.getCell(3).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
  }
  ws.addRow([]);

  // Technical Metrics
  addSectionHeader(ws, 'Technical Metrics', 5);
  const techHeaderRow = ws.addRow(['Metric', 'Value', 'Notes']);
  applySubHeaderRow(techHeaderRow);

  const techMetrics: [string, number | string, string][] = [
    ['Components with HTL', summary.htlComponents, 'Modern rendering (required for AEMaaCS)'],
    ['Components with JSP (Legacy)', summary.jspComponents, summary.jspComponents > 0 ? 'Requires migration for AEMaaCS' : 'Clean — no legacy JSP'],
    ['Components with Sling Model', summary.withSlingModel, 'Proper MVC separation'],
    ['Core Component Model Overrides', summary.withCoreModelOverride, 'Custom Sling Models extending Core'],
    ['Core Proxies Using OOTB Model', summary.coreProxiesWithoutModelOverride, 'Leveraging out-of-the-box models'],
    ['Components with Dialog', summary.withDialog, 'Author-configurable components'],
    ['Components without Dialog', summary.withoutDialog, 'Static or server-side only'],
    ['Average Dialog Fields', summary.averageDialogFields, 'Dialog complexity indicator'],
    ['Duplicate Pairs Found', summary.duplicatePairs, summary.duplicatePairs > 0 ? 'Consolidation opportunity' : 'No duplicates detected'],
    ['Unused Components', summary.unusedComponents, summary.unusedComponents > 0 ? 'Cleanup candidates' : 'All components in use'],
    ['Used Components', summary.usedComponents, 'Active in content'],
  ];

  if (summary.contentPackagesAnalyzed > 0) {
    techMetrics.push(['Content Packages Analyzed', summary.contentPackagesAnalyzed, 'Source for usage data']);
  }
  if (summary.migrationReadiness !== null) {
    techMetrics.push(['Migration Readiness Score', `${summary.migrationReadiness}%`, summary.migrationReadiness >= 90 ? 'Excellent' : summary.migrationReadiness >= 70 ? 'Good — some work needed' : 'Significant migration effort required']);
  }

  rowIdx = 0;
  for (const [label, value, note] of techMetrics) {
    const row = ws.addRow([label, value, note]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };
    row.getCell(2).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
    row.getCell(3).font = { ...MUTED_FONT };
  }
  ws.addRow([]);

  // By Site
  addSectionHeader(ws, 'Components by Site', 5);
  const siteHeaderRow = ws.addRow(['Site', 'Components', '% of Total']);
  applySubHeaderRow(siteHeaderRow);
  rowIdx = 0;
  for (const [site, count] of Object.entries(summary.bySite).sort((a, b) => b[1] - a[1])) {
    const pct = summary.totalComponents > 0 ? Math.round((count / summary.totalComponents) * 100) : 0;
    const row = ws.addRow([site, count, `${pct}%`]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };
  }
  ws.addRow([]);

  // By Group
  addSectionHeader(ws, 'Components by Group', 5);
  const groupHeaderRow = ws.addRow(['Component Group', 'Count', '% of Total']);
  applySubHeaderRow(groupHeaderRow);
  rowIdx = 0;
  for (const [group, count] of Object.entries(summary.byGroup).sort((a, b) => b[1] - a[1])) {
    const pct = summary.totalComponents > 0 ? Math.round((count / summary.totalComponents) * 100) : 0;
    const row = ws.addRow([group || '(ungrouped)', count, `${pct}%`]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };
  }

  // Usage Coverage Summary
  if (result.usageCoverage.length > 0) {
    ws.addRow([]);
    addSectionHeader(ws, 'Usage Coverage Summary', 5);

    const hasAnyPackages = result.summary.contentPackagesAnalyzed > 0;
    if (!hasAnyPackages) {
      const noteRow = ws.addRow(['No content packages provided — usage data is based on local ui.content only.']);
      noteRow.font = { ...MUTED_FONT, italic: true };
      ws.addRow([]);
    }

    const covHeaderRow = ws.addRow(['Project', 'Sites', 'Coverage Status', 'Covered Sites / Pages', 'Missing Sites']);
    applySubHeaderRow(covHeaderRow);

    rowIdx = 0;
    for (const cov of result.usageCoverage) {
      const status = !hasAnyPackages ? 'No Packages' : cov.hasCoverage ? (cov.isPartial ? 'Partial' : 'Full') : 'Missing';
      const coveredDetail = cov.coveredSites.length > 0
        ? cov.coveredSites.join(', ') + ` (${cov.totalPagesFound} pages)`
        : '—';
      const missingDetail = cov.uncoveredSites.length > 0 ? cov.uncoveredSites.join(', ') : '—';

      const row = ws.addRow([
        cov.projectArtifactId,
        cov.sites.join(', '),
        status,
        coveredDetail,
        missingDetail,
      ]);
      applyZebraRow(row, rowIdx++);
      row.font = { ...BODY_FONT };
      row.getCell(1).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };

      const statusCell = row.getCell(3);
      if (status === 'Missing' || status === 'No Packages') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.black } };
        statusCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.white } };
      } else if (status === 'Partial') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.midDark } };
        statusCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.white } };
      } else {
        statusCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
      }
      statusCell.alignment = { horizontal: 'center' };
    }
  }

  addSheetFooter(ws, 5);
  setupPrintArea(ws, 5);
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

// ─── Component Inventory ─────────────────────────────────────────

function addComponentInventory(workbook: ExcelJS.Workbook, result: AuditResult): void {
  const ws = workbook.addWorksheet('Component Inventory', { properties: { tabColor: TAB_COLORS.inventory } });
  const columns = [
    'Resource Type', 'Title', 'Site', 'Group', 'Classification',
    'Super Type', 'OOTB Base', 'Dialog', 'Dialog Fields', 'Dialog Tabs',
    'Edit Config', 'Design Dialog', 'HTL', 'JSP', 'Sling Model',
    'Core Model Override', 'Model Class', 'Client Lib', 'README', 'Usage Count', 'Description',
  ];

  addSheetBanner(ws, 'Component Inventory', `${result.components.length} components across ${result.summary.totalSites} site(s)`, columns.length);

  const headerRow = ws.addRow(columns);
  applyHeaderStyle(headerRow);
  ws.autoFilter = { from: `A${headerRow.number}`, to: `U${headerRow.number}` };
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

  ws.columns = [
    { width: 42 }, { width: 22 }, { width: 14 }, { width: 22 }, { width: 20 },
    { width: 38 }, { width: 32 }, { width: 8 }, { width: 11 }, { width: 10 },
    { width: 10 }, { width: 12 }, { width: 7 }, { width: 7 }, { width: 10 },
    { width: 16 }, { width: 38 }, { width: 10 }, { width: 8 }, { width: 11 }, { width: 38 },
  ];

  let rowIdx = 0;
  for (const comp of result.components) {
    const row = ws.addRow([
      comp.resourceType,
      comp.title,
      comp.site,
      comp.group,
      classificationLabel(comp.classification),
      comp.superType,
      comp.ootbBase,
      boolIcon(comp.hasDialog),
      comp.dialogFieldCount,
      comp.dialogTabCount,
      boolIcon(comp.hasEditConfig),
      boolIcon(comp.hasDesignDialog),
      boolIcon(comp.hasHtl),
      boolIcon(comp.hasJsp),
      boolIcon(comp.hasSlingModel),
      boolIcon(comp.coreModelOverride),
      comp.modelClass,
      boolIcon(comp.hasClientLib),
      boolIcon(comp.hasReadme),
      comp.usageCount,
      comp.description,
    ]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };

    applyClassificationCell(row.getCell(5), comp.classification);
    if (comp.usageCount === 0) {
      row.getCell(20).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.black } };
    }
    if (comp.hasJsp && !comp.hasHtl) {
      row.getCell(14).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.black } };
    }
  }

  addSheetFooter(ws, columns.length);
  setupPrintArea(ws, columns.length);
}

// ─── Classification Detail ───────────────────────────────────────

function addClassificationSheet(workbook: ExcelJS.Workbook, result: AuditResult): void {
  const ws = workbook.addWorksheet('Classification Detail', { properties: { tabColor: TAB_COLORS.classification } });
  const columns = [
    'Resource Type', 'Title', 'Site', 'Classification', 'OOTB Base',
    'Customizations', 'Super Type Chain', 'Detail',
  ];
  addSheetBanner(ws, 'Classification Detail', 'Component proxy chain resolution and OOTB mapping', columns.length);

  const headerRow = ws.addRow(columns);
  applyHeaderStyle(headerRow);
  ws.autoFilter = { from: `A${headerRow.number}`, to: `H${headerRow.number}` };
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

  ws.columns = [
    { width: 42 }, { width: 22 }, { width: 14 }, { width: 22 }, { width: 36 },
    { width: 38 }, { width: 50 }, { width: 48 },
  ];

  let rowIdx = 0;
  for (const comp of result.components) {
    const row = ws.addRow([
      comp.resourceType,
      comp.title,
      comp.site,
      classificationLabel(comp.classification),
      comp.ootbBase,
      comp.customizations.join(', ') || '—',
      comp.superTypeChain.join(' → ') || '—',
      comp.classificationDetail,
    ]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };
    applyClassificationCell(row.getCell(4), comp.classification);
  }

  addSheetFooter(ws, columns.length);
  setupPrintArea(ws, columns.length);
}

// ─── Duplicate Analysis ──────────────────────────────────────────

function addDuplicateSheet(workbook: ExcelJS.Workbook, result: AuditResult): void {
  const ws = workbook.addWorksheet('Duplicate Analysis', { properties: { tabColor: TAB_COLORS.duplicates } });
  const columns = [
    'Component A', 'Site A', 'Component B', 'Site B',
    'Similarity %', 'Matching Files', 'Differing Files', 'Recommendation',
  ];
  addSheetBanner(ws, 'Duplicate Analysis', `${result.duplicates.length} pair(s) detected via hash-based similarity`, columns.length);

  const headerRow = ws.addRow(columns);
  applyHeaderStyle(headerRow);
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

  ws.columns = [
    { width: 42 }, { width: 14 }, { width: 42 }, { width: 14 },
    { width: 14 }, { width: 38 }, { width: 38 }, { width: 22 },
  ];

  if (result.duplicates.length === 0) {
    const emptyRow = ws.addRow(['No duplicate components detected with the configured threshold.']);
    emptyRow.font = { ...MUTED_FONT, italic: true };
    addSheetFooter(ws, columns.length);
    return;
  }

  let rowIdx = 0;
  for (const dup of result.duplicates) {
    const row = ws.addRow([
      dup.componentA,
      dup.siteA,
      dup.componentB,
      dup.siteB,
      dup.similarity,
      dup.matchingFiles.join(', '),
      dup.differingFiles.join(', '),
      formatRecommendation(dup.recommendation),
    ]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };

    const simCell = row.getCell(5);
    simCell.alignment = { horizontal: 'center' };
    if (dup.similarity === 100) {
      simCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.black } };
      simCell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: BRAND.white } };
    } else if (dup.similarity >= 80) {
      simCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.midGray } };
      simCell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: BRAND.textDark } };
    } else {
      simCell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: BRAND.textDark } };
    }

    const recCell = row.getCell(8);
    recCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
  }

  addSheetFooter(ws, columns.length);
  setupPrintArea(ws, columns.length);
}

// ─── Usage Analysis ──────────────────────────────────────────────

function addUsageSheet(workbook: ExcelJS.Workbook, result: AuditResult): void {
  const ws = workbook.addWorksheet('Usage Analysis', { properties: { tabColor: TAB_COLORS.usage } });
  const columns = ['Resource Type', 'Title', 'Site', 'Classification', 'Usage Count', 'Status', 'Top Pages'];

  const missingProjects = result.usageCoverage.filter((c) => !c.hasCoverage);
  const partialProjects = result.usageCoverage.filter((c) => c.isPartial);
  let subtitle = `${result.summary.usedComponents} used, ${result.summary.unusedComponents} unused component(s)`;
  if (missingProjects.length > 0) {
    subtitle += ` | ${missingProjects.length} project(s) missing content packages`;
  }
  if (partialProjects.length > 0) {
    subtitle += ` | ${partialProjects.length} project(s) with partial coverage`;
  }

  addSheetBanner(ws, 'Usage Analysis', subtitle, columns.length);

  if (missingProjects.length > 0) {
    const warnRow = ws.addRow([
      `Note: Content packages not provided for: ${missingProjects.map((p) => p.projectArtifactId).join(', ')}. Usage counts for these projects may be incomplete.`,
    ]);
    warnRow.font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
    warnRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.lightGray } };
    ws.mergeCells(`A${warnRow.number}:${colLetter(columns.length)}${warnRow.number}`);
    ws.addRow([]);
  }

  const headerRow = ws.addRow(columns);
  applyHeaderStyle(headerRow);
  ws.autoFilter = { from: `A${headerRow.number}`, to: `G${headerRow.number}` };
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

  ws.columns = [
    { width: 42 }, { width: 22 }, { width: 14 }, { width: 20 }, { width: 14 }, { width: 14 }, { width: 58 },
  ];

  const sorted = [...result.components].sort((a, b) => b.usageCount - a.usageCount);
  let rowIdx = 0;
  for (const comp of sorted) {
    const status = comp.usageCount === 0 ? 'UNUSED' : comp.usageCount >= 10 ? 'Heavy' : comp.usageCount >= 3 ? 'Moderate' : 'Light';
    const row = ws.addRow([
      comp.resourceType,
      comp.title,
      comp.site,
      classificationLabel(comp.classification),
      comp.usageCount,
      status,
      comp.usagePages.slice(0, 5).join(', ') || '—',
    ]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };

    const countCell = row.getCell(5);
    countCell.alignment = { horizontal: 'center' };
    const statusCell = row.getCell(6);
    statusCell.alignment = { horizontal: 'center' };

    if (comp.usageCount === 0) {
      countCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.black } };
      statusCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.white } };
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.black } };
    } else {
      countCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
    }
  }

  addSheetFooter(ws, columns.length);
  setupPrintArea(ws, columns.length);
}

// ─── Cross-Site Reuse ────────────────────────────────────────────

function addCrossSiteSheet(workbook: ExcelJS.Workbook, result: AuditResult): void {
  const ws = workbook.addWorksheet('Cross-Site Reuse', { properties: { tabColor: TAB_COLORS.crossSite } });
  const columns = [
    'Component Name', 'Sites', 'Site Count', 'Identical?', 'Similarity %', 'Differences', 'Action',
  ];
  addSheetBanner(ws, 'Cross-Site Reuse', 'Component overlap analysis across sites', columns.length);

  const headerRow = ws.addRow(columns);
  applyHeaderStyle(headerRow);
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

  ws.columns = [
    { width: 26 }, { width: 38 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 48 }, { width: 26 },
  ];

  if (result.crossSiteReuse.length === 0) {
    const emptyRow = ws.addRow(['No cross-site component reuse detected.']);
    emptyRow.font = { ...MUTED_FONT, italic: true };
    addSheetFooter(ws, columns.length);
    return;
  }

  let rowIdx = 0;
  for (const entry of result.crossSiteReuse) {
    const action = entry.identical
      ? 'Consolidate into shared library'
      : entry.similarity >= 80
        ? 'Evaluate for merge'
        : 'Keep separate';
    const row = ws.addRow([
      entry.leafName,
      entry.sites.join(', '),
      entry.sites.length,
      entry.identical ? 'Yes' : 'No',
      entry.similarity,
      entry.differences.join(', ') || '—',
      action,
    ]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'center' };

    if (entry.identical) {
      row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.black } };
      row.getCell(4).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.white } };
      row.getCell(7).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.black } };
    }
  }

  addSheetFooter(ws, columns.length);
  setupPrintArea(ws, columns.length);
}

// ─── Recommendations ─────────────────────────────────────────────

function addRecommendationsSheet(workbook: ExcelJS.Workbook, result: AuditResult): void {
  const ws = workbook.addWorksheet('Recommendations', { properties: { tabColor: TAB_COLORS.recommendations } });
  const columns = [
    '#', 'Category', 'Impact', 'Finding', 'Recommendation', 'Affected Components', 'Component Count',
  ];
  addSheetBanner(ws, 'Recommendations', `${result.recommendations.length} prioritized action items`, columns.length);

  const headerRow = ws.addRow(columns);
  applyHeaderStyle(headerRow);
  ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

  ws.columns = [
    { width: 6 }, { width: 18 }, { width: 10 }, { width: 48 }, { width: 58 }, { width: 58 }, { width: 14 },
  ];

  if (result.recommendations.length === 0) {
    const emptyRow = ws.addRow(['', 'No actionable recommendations at this time.']);
    emptyRow.font = { ...MUTED_FONT, italic: true };
    addSheetFooter(ws, columns.length);
    return;
  }

  let rowIdx = 0;
  for (const rec of result.recommendations) {
    const row = ws.addRow([
      rowIdx + 1,
      rec.category.charAt(0).toUpperCase() + rec.category.slice(1),
      rec.impact.toUpperCase(),
      rec.finding,
      rec.recommendation,
      rec.affectedComponents.slice(0, 10).join('\n') +
        (rec.affectedComponents.length > 10 ? `\n... and ${rec.affectedComponents.length - 10} more` : ''),
      rec.affectedComponents.length,
    ]);
    applyZebraRow(row, rowIdx++);
    row.font = { ...BODY_FONT };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
    row.getCell(1).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textGray } };

    const impactCell = row.getCell(3);
    const impactFills: Record<string, string> = { high: BRAND.black, medium: BRAND.darkGray, low: BRAND.midGray };
    const impactFonts: Record<string, string> = { high: BRAND.white, medium: BRAND.white, low: BRAND.textDark };
    const impactFill = impactFills[rec.impact];
    if (impactFill) {
      impactCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: impactFill } };
      impactCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: impactFonts[rec.impact] } };
    }
    impactCell.alignment = { horizontal: 'center', vertical: 'top' };

    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(6).font = { size: 9, name: 'Calibri', color: { argb: BRAND.textGray } };
    row.getCell(7).alignment = { horizontal: 'center', vertical: 'top' };
    row.getCell(7).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textDark } };
  }

  addSheetFooter(ws, columns.length);
  setupPrintArea(ws, columns.length);
}

// ─── Shared Helpers ──────────────────────────────────────────────

function addSheetBanner(ws: ExcelJS.Worksheet, title: string, subtitle: string, colSpan: number): void {
  // Brand bar
  const barRow = ws.addRow([]);
  fillRow(barRow, 1, colSpan, BRAND.black.slice(2));
  barRow.height = 4;

  // Title row
  const titleRow = ws.addRow([title]);
  titleRow.font = { bold: true, size: 14, color: { argb: BRAND.black }, name: 'Calibri' };
  titleRow.height = 24;
  ws.mergeCells(`A${titleRow.number}:${colLetter(colSpan)}${titleRow.number}`);

  // Subtitle row
  const subRow = ws.addRow([subtitle]);
  subRow.font = { size: 10, color: { argb: BRAND.textGray }, name: 'Calibri' };
  ws.mergeCells(`A${subRow.number}:${colLetter(colSpan)}${subRow.number}`);
}

function addSheetFooter(ws: ExcelJS.Worksheet, colSpan: number): void {
  ws.addRow([]);
  const footerRow = ws.addRow(['Confidential — Prepared by DEPT']);
  footerRow.font = { size: 8, color: { argb: BRAND.textGray }, name: 'Calibri', italic: true };
  ws.mergeCells(`A${footerRow.number}:${colLetter(colSpan)}${footerRow.number}`);
  ws.headerFooter = {
    oddFooter: '&L&8Confidential — DEPT&C&8Page &P of &N&R&8AEM Component Tech Audit',
  };
}

function addSectionHeader(ws: ExcelJS.Worksheet, title: string, colSpan: number): void {
  const row = ws.addRow([title]);
  row.font = { bold: true, size: 12, color: { argb: BRAND.black }, name: 'Calibri' };
  row.height = 22;
  row.getCell(1).fill = SECTION_FILL;
  ws.mergeCells(`A${row.number}:${colLetter(colSpan)}${row.number}`);
}

function addLabelValueRow(ws: ExcelJS.Worksheet, label: string, value: string): void {
  const row = ws.addRow([label, value]);
  row.getCell(1).font = { bold: true, size: 10, name: 'Calibri', color: { argb: BRAND.textGray } };
  row.getCell(2).font = { ...BODY_FONT };
  row.border = CELL_BORDER;
}

function applyHeaderStyle(row: ExcelJS.Row): void {
  row.height = 28;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: BRAND.black } } };
  });
}

function applySubHeaderRow(row: ExcelJS.Row): void {
  row.height = 22;
  row.eachCell((cell) => {
    cell.fill = SUB_HEADER_FILL;
    cell.font = SUB_HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}

function applyZebraRow(row: ExcelJS.Row, index: number): void {
  const fill = index % 2 === 0 ? ROW_EVEN_FILL : ROW_ODD_FILL;
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb === BRAND.white || (cell.fill as ExcelJS.FillPattern).fgColor?.argb === BRAND.offWhite) {
      cell.fill = fill;
    }
  });
  row.border = CELL_BORDER;
}

function fillRow(row: ExcelJS.Row, start: number, end: number, argb: string): void {
  for (let i = start; i <= end; i++) {
    row.getCell(i).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: argb.startsWith('FF') ? argb : `FF${argb}` },
    };
  }
}

function setupPrintArea(ws: ExcelJS.Worksheet, cols: number): void {
  ws.pageSetup = {
    orientation: cols > 8 ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
}

function colLetter(n: number): string {
  let result = '';
  let num = n;
  while (num > 0) {
    num--;
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

function boolIcon(value: boolean): string {
  return value ? '✓' : '—';
}

function classificationLabel(key: string): string {
  const labels: Record<string, string> = {
    ootb: 'Pure OOTB',
    proxied: 'Proxied (Pure)',
    'proxied-customized': 'Proxied + Customized',
    custom: 'Pure Custom',
  };
  return labels[key] ?? key;
}

function classificationAssessment(key: string, pct: number): string {
  const assessments: Record<string, string> = {
    ootb: pct > 20 ? 'High OOTB utilization — good reuse' : 'Low OOTB usage',
    proxied: 'Proper proxy pattern in use',
    'proxied-customized': pct > 40 ? 'Heavy customization layer — review needed' : 'Moderate customization',
    custom: pct > 50 ? 'High custom ratio — evaluate consolidation' : 'Acceptable custom component count',
  };
  return assessments[key] ?? '';
}

function applyClassificationCell(cell: ExcelJS.Cell, key: string): void {
  const fill = CLASSIFICATION_FILLS[key];
  const fontColor = CLASSIFICATION_FONTS[key];
  if (fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: fontColor ?? BRAND.textDark } };
  }
}

function formatRecommendation(rec: DuplicateMatch['recommendation']): string {
  const labels: Record<string, string> = {
    merge: 'Merge into shared library',
    'keep-separate': 'Keep separate (reviewed)',
    'remove-duplicate': 'Remove duplicate',
  };
  return labels[rec] ?? rec;
}
