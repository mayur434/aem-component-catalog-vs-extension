/**
 * Shared contract for a tab inside the unified Catalog panel.
 *
 * A tab module owns exactly one <section id="tab-{name}"> in the merged
 * document. To stay collision-free when concatenated with the other two
 * tabs into one HTML document, a tab module MUST:
 *  - prefix every element id it renders/queries with its own short prefix
 *    (ov- / cfg- / aud-)
 *  - scope every top-level CSS selector in `styles` under `#tab-{name} `
 *    (except :root, which is inherently global and safe to leave as-is
 *    since all three tabs already agree on the same variable values)
 *  - never call acquireVsCodeApi() itself — the shared `vscode` handle is
 *    injected as the sole parameter of the IIFE the orchestrator wraps
 *    `script` in
 *  - add `tab: '{name}'` to every outgoing postMessage payload
 */
export interface TabRenderResult {
  /** Inner HTML for this tab's <section>. No outer wrapper, no <style>/<script> tags. */
  bodyHtml: string;
  /** CSS rule text only (no <style> tags), every top-level selector scoped under #tab-{name}. */
  styles: string;
  /** JS source text only (no <script> tags, no acquireVsCodeApi() call). Wrapped by the orchestrator in `(function(vscode){ ... })(vscode)`. */
  script: string;
}
