import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { ContentPackageMeta, UsageRecord } from './types';

export interface ContentPackageParseResult {
  usage: Map<string, UsageRecord>;
  meta: ContentPackageMeta;
}

export function parseContentPackages(packagePaths: string[]): ContentPackageParseResult {
  const usage = new Map<string, UsageRecord>();
  const sitePages = new Map<string, Set<string>>();

  for (const pkgPath of packagePaths) {
    if (!fs.existsSync(pkgPath)) continue;
    let stat: fs.Stats;
    let isDirectory: boolean;
    try {
      stat = fs.statSync(pkgPath);
      isDirectory = stat.isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      const zips = fs.readdirSync(pkgPath)
        .filter((f) => f.endsWith('.zip'))
        .map((f) => path.join(pkgPath, f));
      for (const zip of zips) {
        parseOnePackage(zip, usage, sitePages);
      }
    } else if (pkgPath.endsWith('.zip')) {
      parseOnePackage(pkgPath, usage, sitePages);
    }
  }

  const sitePageCounts: Record<string, number> = {};
  let totalPages = 0;
  for (const [site, pages] of sitePages) {
    sitePageCounts[site] = pages.size;
    totalPages += pages.size;
  }

  return { usage, meta: { sitePageCounts, totalPages } };
}

function parseOnePackage(zipPath: string, usage: Map<string, UsageRecord>, sitePages: Map<string, Set<string>>): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    return;
  }

  let entries: ReturnType<typeof zip.getEntries>;
  try {
    entries = zip.getEntries();
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.entryName.endsWith('.content.xml') && !entry.entryName.endsWith('.xml')) {
      continue;
    }
    if (!entry.entryName.startsWith('jcr_root/content/')) continue;

    let content: string;
    try {
      const buffer = entry.getData();
      content = buffer.toString('utf-8');
    } catch {
      continue;
    }

    const pagePath = extractPagePath(entry.entryName);
    const siteRoot = extractSiteRoot(entry.entryName);
    if (siteRoot && pagePath) {
      const pages = sitePages.get(siteRoot) ?? new Set<string>();
      pages.add(pagePath);
      sitePages.set(siteRoot, pages);
    }

    for (const match of content.matchAll(/sling:resourceType=["']([^"']+)["']/g)) {
      const resourceType = match[1];
      const record = usage.get(resourceType) ?? { resourceType, count: 0, pages: [] };
      record.count++;
      if (pagePath && !record.pages.includes(pagePath) && record.pages.length < 20) {
        record.pages.push(pagePath);
      }
      usage.set(resourceType, record);
    }
  }
}

function extractPagePath(entryName: string): string {
  const withoutPrefix = entryName.replace(/^jcr_root/, '');
  const parts = withoutPrefix.split('/');
  const jcrContentIndex = parts.indexOf('jcr:content');
  if (jcrContentIndex > 0) {
    return parts.slice(0, jcrContentIndex).join('/');
  }
  const contentXmlIndex = parts.findIndex((p) => p === '.content.xml');
  if (contentXmlIndex > 0) {
    return parts.slice(0, contentXmlIndex).join('/');
  }
  return parts.slice(0, -1).join('/');
}

function extractSiteRoot(entryName: string): string {
  const match = entryName.match(/^jcr_root\/content\/([^/]+)/);
  return match ? match[1] : '';
}
