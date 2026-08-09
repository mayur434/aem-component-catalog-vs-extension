---
sidebar_position: 5
---

# Troubleshooting

### No AEMaaCS project found

Confirm the reactor POM uses `packaging=pom`, declares modules, and contains `aem-sdk-api`, the AEM analyser, or the standard Cloud module/Dispatcher structure. The tool only activates for **positively identified** AEMaaCS reactors — it will not guess.

### Doctor reports package-separation errors

Keep immutable code below `/apps` in `ui.apps`; put OSGi configuration in `ui.config`; put mutable content in `ui.content`, or provision supported baseline structures through RepoInit instead.

### Generation reports a conflict

Open **Preview** and review the diff. Preserve the file and migrate the customization into configuration, or use the CLI's `--force` flag only when replacement is genuinely intended — review the plan first with `preview`/`plan`.

### Catalog endpoint returns 404

The endpoint is author-only by design. Verify the request is being made against Author, and that the catalog page exists after the author-scoped RepoInit configuration has run.

### Need support information

Run **Export Redacted Support Bundle** (or `aem-catalog support --project . --output support.json` from the CLI). Inspect the JSON yourself before sharing it with a support team — project-root paths and secret-like configuration keys are redacted, but you should still confirm nothing sensitive to your project remains before it leaves the organization.

---

Continue to [Business Outcomes](../outcomes) to see what this tool is meant to achieve end-to-end.
