/**
 * Platform adapters — the single place that knows which directories a given
 * platform uses for components, server-side models, authored content, and
 * local deployment. The scanner, audit engine, and deploy command all read
 * these lists instead of hardcoding module names themselves, so supporting a
 * new platform (e.g. Adobe Edge Delivery Services) means adding one adapter
 * here — not touching every consumer.
 */
import type { AemPlatform } from './projectDetector';

export type AdapterPlatform = AemPlatform | 'eds';

export interface PlatformAdapter {
  readonly id: AdapterPlatform;
  readonly label: string;
  /**
   * Relative paths (from the project root) to try, in order, for the base
   * directory that holds UI component/block definitions. For AEM this already
   * bakes in the src/main/content/jcr_root convention — callers append their
   * own site- or config-specific sub-path (e.g. "apps/<site>/components") on
   * top of whichever candidate exists.
   */
  readonly componentRoots: string[];
  /**
   * Relative paths to try for server-side model/logic code (Java Sling Models
   * for AEM). Empty for platforms with no separate model layer.
   */
  readonly modelRoots: string[];
  /**
   * Relative paths to try for authored/rendered content, used to count how
   * often each component actually appears on a page.
   */
  readonly usageRoots: string[];
  /**
   * Fixed, safety-reviewed allowlist of bare module names that may be built
   * and deployed to a local instance. This is NOT a discovery probe like the
   * three lists above — it must never include a module that can hold authored
   * content (e.g. ui.content, or an EDS content root), regardless of platform.
   * Empty for platforms with no local-deploy concept (EDS ships via git push).
   */
  readonly deployableModules: string[];
}

/**
 * Freezes both the adapter object and each of its array fields, so nothing —
 * today or in a future edit — can mutate a shared candidate list at runtime
 * (e.g. an accidental `.push('ui.content')` onto deployableModules). Each
 * adapter gets its own frozen arrays rather than sharing references, even
 * where two adapters currently have identical values.
 */
function freezeAdapter(adapter: PlatformAdapter): PlatformAdapter {
  Object.freeze(adapter.componentRoots);
  Object.freeze(adapter.modelRoots);
  Object.freeze(adapter.usageRoots);
  Object.freeze(adapter.deployableModules);
  return Object.freeze(adapter);
}

const AEM_ADAPTER: PlatformAdapter = freezeAdapter({
  id: 'aemaacs',
  label: 'AEMaaCS',
  // AEMaaCS and AEM AMS are tolerated identically here: both module-naming
  // conventions ('ui.apps'/'core' vs 'content'/'bundle') are checked
  // regardless of which platform was detected, since real-world AMS reactors
  // are frequently bootstrapped from the same archetype and mix both.
  componentRoots: ['ui.apps/src/main/content/jcr_root', 'content/src/main/content/jcr_root'],
  modelRoots: ['core/src/main/java', 'bundle/src/main/java'],
  usageRoots: [
    'ui.content/src/main/content/jcr_root',
    'ui.apps/src/main/content/jcr_root',
    'content/src/main/content/jcr_root',
  ],
  deployableModules: ['core', 'bundle', 'ui.apps', 'ui.config'],
});

const AMS_ADAPTER: PlatformAdapter = freezeAdapter({
  id: 'ams',
  label: 'AEM AMS',
  componentRoots: [...AEM_ADAPTER.componentRoots],
  modelRoots: [...AEM_ADAPTER.modelRoots],
  usageRoots: [...AEM_ADAPTER.usageRoots],
  deployableModules: [...AEM_ADAPTER.deployableModules],
});

/**
 * Stub for a future Adobe Edge Delivery Services adapter. EDS has no Maven
 * reactor, no JCR, and no separate model layer — a "component" is a
 * self-contained JS+CSS block, typically under a top-level `blocks/`
 * directory. Project detection for EDS is not wired up yet (ProjectInfo is
 * still Maven/Java-shaped, via projectDetector.ts's parseAemCloudProject /
 * parseAmsProject); this exists so the adapter interface is proven to
 * generalize beyond AEM, and so a real EDS adapter has a clear home once
 * project detection is extended to recognize EDS repos (fstab.yaml + blocks/).
 */
const EDS_ADAPTER: PlatformAdapter = freezeAdapter({
  id: 'eds',
  label: 'Edge Delivery Services',
  componentRoots: ['blocks'],
  modelRoots: [],
  usageRoots: ['blocks'],
  deployableModules: [],
});

const ADAPTERS: Record<AdapterPlatform, PlatformAdapter> = {
  aemaacs: AEM_ADAPTER,
  ams: AMS_ADAPTER,
  eds: EDS_ADAPTER,
};

export function getPlatformAdapter(platform: AdapterPlatform): PlatformAdapter {
  return ADAPTERS[platform];
}

/**
 * Component/model/usage discovery and the deploy allowlist are identical
 * across AEMaaCS and AEM AMS today — only reactor-detection heuristics
 * (isAemCloudReactor/isAmsReactor in projectDetector.ts) and UI labeling
 * differ. Callers that don't have a specific project's platform in scope
 * (e.g. componentScanner.ts, handed a bare project root) can use this
 * instead of guessing which of the two identical adapters to ask for.
 */
export function getAemAdapter(): PlatformAdapter {
  return AEM_ADAPTER;
}
