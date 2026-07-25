import * as fs from 'fs';
import * as path from 'path';
import { assertPathInside, resolveExistingPath } from '../utils/pathSecurity';

export type FindingSeverity = 'error' | 'warning' | 'info';
export type PolicyLevel = FindingSeverity | 'off';

export interface EnterprisePolicy {
  schemaVersion: 1;
  extends: Array<'recommended-aemaacs' | 'strict-aemaacs'>;
  rules: Record<string, PolicyLevel>;
  minimumQualityScore: number;
  allowedStatuses: string[];
}

const recommendedRules: Record<string, PolicyLevel> = {
  'aemaacs.project': 'error',
  'aemaacs.modules': 'error',
  'aemaacs.dispatcher': 'warning',
  'aemaacs.package-separation': 'error',
  'aemaacs.all-embeds': 'warning',
  'aemaacs.repoinit': 'error',
  'catalog.author-only': 'error',
  'catalog.config': 'error',
  'catalog.generated-drift': 'warning',
  'component.require-dialog': 'warning',
  'component.require-readme': 'warning',
  'component.require-thumbnail': 'warning',
  'component.require-owner': 'warning',
  'component.require-status': 'warning',
  'component.require-version': 'info',
  'component.minimum-quality': 'warning',
};

export function defaultPolicy(): EnterprisePolicy {
  return {
    schemaVersion: 1,
    extends: ['recommended-aemaacs'],
    rules: { ...recommendedRules },
    minimumQualityScore: 70,
    allowedStatuses: ['draft', 'active', 'deprecated'],
  };
}

export function loadPolicy(projectRoot: string, policyFile = '.aem-catalog-policy.json'): EnterprisePolicy {
  const file = assertPathInside(projectRoot, path.resolve(projectRoot, policyFile), 'Policy file');
  if (!fs.existsSync(file)) {
    return defaultPolicy();
  }
  assertPathInside(projectRoot, resolveExistingPath(file), 'Policy file');
  const user = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<EnterprisePolicy>;
  const presets: EnterprisePolicy['extends'] = user.extends?.length ? user.extends : ['recommended-aemaacs'];
  const rules = { ...recommendedRules };
  if (presets.includes('strict-aemaacs')) {
    for (const rule of Object.keys(rules)) {
      if (rules[rule] === 'warning') rules[rule] = 'error';
    }
  }
  for (const [rule, level] of Object.entries(user.rules ?? {})) {
    if (!['error', 'warning', 'info', 'off'].includes(level)) {
      throw new Error(`Invalid policy level for ${rule}: ${String(level)}`);
    }
    rules[rule] = level;
  }
  return {
    schemaVersion: 1,
    extends: presets,
    rules,
    minimumQualityScore: clamp(user.minimumQualityScore ?? 70, 0, 100),
    allowedStatuses: user.allowedStatuses?.map(String) ?? ['draft', 'active', 'deprecated'],
  };
}

export function policyLevel(
  policy: EnterprisePolicy,
  ruleId: string,
  fallback: FindingSeverity,
): PolicyLevel {
  return policy.rules[ruleId] ?? fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
