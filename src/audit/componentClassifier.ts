import * as fs from 'fs';
import * as path from 'path';
import type { ComponentClassification } from './types';

const OOTB_PREFIXES = [
  'core/wcm/components/',
  'core/cif/components/',
  'core/email/components/',
  'core/fd/components/',
  'wcm/foundation/components/',
  'foundation/components/',
  'commerce/components/',
  'cq/experience-fragments/',
  'dam/cfm/',
  'fd/af/',
  'social/commons/components/',
  'core/wcm/sandbox/',
];

export function isOotbResourceType(resourceType: string): boolean {
  return OOTB_PREFIXES.some((prefix) => resourceType.startsWith(prefix));
}

export function resolveClassification(
  resourceType: string,
  superType: string,
  superTypeChain: string[],
  componentDir: string,
): { classification: ComponentClassification; detail: string; ootbBase: string; customizations: string[] } {
  if (isOotbResourceType(resourceType)) {
    return { classification: 'ootb', detail: 'OOTB component', ootbBase: resourceType, customizations: [] };
  }

  const ootbAncestor = superTypeChain.find(isOotbResourceType);

  if (!ootbAncestor) {
    return { classification: 'custom', detail: 'No OOTB ancestor in super type chain', ootbBase: '', customizations: [] };
  }

  const customizations = detectCustomizations(componentDir);

  if (customizations.length === 0) {
    return {
      classification: 'proxied',
      detail: `Pure proxy of ${ootbAncestor}`,
      ootbBase: ootbAncestor,
      customizations: [],
    };
  }

  return {
    classification: 'proxied-customized',
    detail: `Extends ${ootbAncestor} with: ${customizations.join(', ')}`,
    ootbBase: ootbAncestor,
    customizations,
  };
}

export function buildSuperTypeChain(
  resourceType: string,
  superTypeMap: Map<string, string>,
  maxDepth = 10,
): string[] {
  const chain: string[] = [];
  let current = superTypeMap.get(resourceType);
  let depth = 0;
  while (current && depth < maxDepth) {
    chain.push(current);
    current = superTypeMap.get(current);
    depth++;
  }
  return chain;
}

function detectCustomizations(componentDir: string): string[] {
  const customizations: string[] = [];

  if (hasCustomDialog(componentDir)) customizations.push('custom dialog');
  if (hasCustomHtl(componentDir)) customizations.push('custom HTL');
  if (hasCustomClientLib(componentDir)) customizations.push('custom clientlib');
  if (hasCustomEditConfig(componentDir)) customizations.push('custom editConfig');
  if (hasCustomDesignDialog(componentDir)) customizations.push('custom design dialog');

  return customizations;
}

function hasCustomDialog(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, '_cq_dialog', '.content.xml')) ||
    fs.existsSync(path.join(dir, 'cq:dialog', '.content.xml'))
  );
}

function hasCustomHtl(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith('.html') && !f.startsWith('.'));
  } catch {
    return false;
  }
}

function hasCustomClientLib(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((f) => {
      const full = path.join(dir, f);
      return fs.statSync(full).isDirectory() && f === 'clientlibs';
    });
  } catch {
    return false;
  }
}

function hasCustomEditConfig(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, '_cq_editConfig', '.content.xml')) ||
    fs.existsSync(path.join(dir, 'cq:editConfig', '.content.xml'))
  );
}

function hasCustomDesignDialog(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, '_cq_design_dialog', '.content.xml')) ||
    fs.existsSync(path.join(dir, 'cq:design_dialog', '.content.xml'))
  );
}
