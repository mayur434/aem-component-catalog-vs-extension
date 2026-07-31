import type { AemPlatform } from '../scanner/projectDetector';

export type ComponentClassification =
  | 'ootb'
  | 'proxied'
  | 'proxied-customized'
  | 'custom';

export interface AuditComponent {
  name: string;
  title: string;
  description: string;
  group: string;
  resourceType: string;
  superType: string;
  superTypeChain: string[];
  path: string;
  sourcePath: string;
  site: string;
  classification: ComponentClassification;
  classificationDetail: string;
  ootbBase: string;
  hasDialog: boolean;
  hasEditConfig: boolean;
  hasDesignDialog: boolean;
  hasReadme: boolean;
  hasHtl: boolean;
  hasJsp: boolean;
  hasSlingModel: boolean;
  /** True when a project-level Sling Model overrides or extends the Core Component model. */
  coreModelOverride: boolean;
  hasClientLib: boolean;
  dialogFieldCount: number;
  dialogTabCount: number;
  modelClass: string;
  usageCount: number;
  usagePages: string[];
  fileHashes: Map<string, string>;
  customizations: string[];
}

export interface DuplicateMatch {
  componentA: string;
  componentB: string;
  siteA: string;
  siteB: string;
  similarity: number;
  matchingFiles: string[];
  differingFiles: string[];
  recommendation: 'merge' | 'keep-separate' | 'remove-duplicate';
}

export interface UsageRecord {
  resourceType: string;
  count: number;
  pages: string[];
}

export interface CrossSiteEntry {
  leafName: string;
  sites: string[];
  identical: boolean;
  similarity: number;
  differences: string[];
}

export interface AuditRecommendation {
  category: 'consolidation' | 'cleanup' | 'migration' | 'governance' | 'performance';
  finding: string;
  impact: 'high' | 'medium' | 'low';
  recommendation: string;
  affectedComponents: string[];
}

export interface ProjectAuditInfo {
  root: string;
  artifactId: string;
  groupId: string;
  version: string;
  platform: AemPlatform;
  javaVersion: string;
}

export interface AuditSummary {
  totalComponents: number;
  totalSites: number;
  byClassification: Record<ComponentClassification, number>;
  byGroup: Record<string, number>;
  bySite: Record<string, number>;
  duplicatePairs: number;
  unusedComponents: number;
  usedComponents: number;
  htlComponents: number;
  jspComponents: number;
  withSlingModel: number;
  /** Components that proxy a Core Component AND have a project-level Sling Model override. */
  withCoreModelOverride: number;
  /** Core Component proxies that rely on the OOTB model (no project-level override). */
  coreProxiesWithoutModelOverride: number;
  withDialog: number;
  withoutDialog: number;
  averageDialogFields: number;
  contentPackagesAnalyzed: number;
  migrationReadiness: number | null;
}

export interface AuditResult {
  projects: ProjectAuditInfo[];
  components: AuditComponent[];
  duplicates: DuplicateMatch[];
  crossSiteReuse: CrossSiteEntry[];
  usage: Map<string, UsageRecord>;
  usageCoverage: UsageCoverage[];
  contentPackageMeta: ContentPackageMeta;
  summary: AuditSummary;
  recommendations: AuditRecommendation[];
  generatedAt: string;
}

export interface UsageCoverage {
  projectArtifactId: string;
  projectRoot: string;
  sites: string[];
  coveredSites: string[];
  uncoveredSites: string[];
  totalPagesFound: number;
  hasCoverage: boolean;
  isPartial: boolean;
}

export interface ContentPackageMeta {
  sitePageCounts: Record<string, number>;
  totalPages: number;
}

export interface AuditOptions {
  contentPackagePaths: string[];
  includeUsagePages: boolean;
  duplicateThreshold: number;
}
