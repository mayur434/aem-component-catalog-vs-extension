---
sidebar_position: 5
---

# Business Outcomes & Goal Achieved

## The starting problem

Before this tool, each brand reactor in a multi-brand AEM program carried its own component library with no shared, browsable view of what existed, what was documented, who owned it, or whether it met a minimum authoring standard. That's invisible technical debt: it doesn't block a release, but it steadily raises the cost of onboarding, code review, and cross-brand consistency, and it hides duplicate work between brands that nobody can see without manually diffing component trees.

## What version 2.0 delivers

The `2.0.0` release (2026-07-22) marked a deliberate scope narrowing and hardening pass: it temporarily dropped Adobe Managed Services (AMS) **generation** support in favor of doing the AEMaaCS case completely and safely first. That gap has since been closed: AMS reactors (including ones using the alternate `bundle`/`content` module naming) now go through the exact same detection, preflight, remediation, and transactional generation pipeline as AEMaaCS — see [Getting Started](./usage-manual/getting-started) for the current platform-support scope. What 2.0 established, and what still holds today:

- A **governed, generated catalog micro-site** per reactor — deployed as real Maven module artifacts (`core`/`bundle` servlet, `ui.apps`/`content` component + clientlib, `ui.config` RepoInit/service-user), not a static export that drifts from reality.
- A **shared, deterministic engine** behind both the VS Code UI and the CI-usable CLI, so "it works when I run it" and "it works in the pipeline" are the same claim.
- **Explainable governance**, end to end: a weighted quality score, an organization policy with per-rule severity, SARIF output for pull-request code scanning, and a Cloud Doctor check that covers project structure, package boundaries, RepoInit shape, and documentation completeness.
- A **transactional, reversible generation model** — plan, classify, write atomically, roll back on failure or on demand — so adopting the tool never risks a brand's hand-authored customization.
- A **cross-brand duplicate-detection audit** (Excel output, covering AEMaaCS and AMS alike) that answers a question the per-reactor catalog view structurally can't: where are brands quietly duplicating the same component?
- A **security and privacy posture** — no telemetry, an author-only runtime, a hardened webview, redacted diagnostics — built to pass an enterprise security review without special-casing.

## Where this is heading in practice

The catalog's "Sanitized README rendering" feature is exactly what makes richer, per-component authoring documentation possible in the browsable catalog rather than just a field-name list. Teams can use that capability to backfill every component in a library with a structured authoring guide — intent, authoring fields with type/description/required-ness, an image spec where relevant, a worked example, and guard rails — stored in the DAM alongside each component's thumbnail, using the same pattern the tool already uses for images. That turns the catalog into something both technical and non-technical stakeholders can understand without opening a component's dialog XML.

## The measurable goal

Put together, the tool turns four previously unanswerable questions into things any stakeholder can check in minutes, per brand or across all of them:

1. **What components exist, and are they documented?** — Scan report + quality score.
2. **Does this reactor meet our governance bar?** — Cloud Doctor + policy, enforceable in CI.
3. **Are brands duplicating work?** — Tech Audit Report.
4. **Can we change this safely?** — Preview, atomic generation, and rollback, every time.

That is the end goal this tool was built to reach: one governed, safely-generated, cross-brand component catalog — not several separate, undocumented ones.
