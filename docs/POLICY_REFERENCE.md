# Policy Reference

Policies use severity values `error`, `warning`, `info`, or `off`.

| Rule                          | Recommended | Purpose                                                           |
| ----------------------------- | ----------- | ----------------------------------------------------------------- |
| `aemaacs.project`             | error       | Positive Cloud SDK/analyser or standard Cloud structure detection |
| `aemaacs.modules`             | error       | Required reactor modules and recommended Dispatcher module        |
| `aemaacs.package-separation`  | error       | Immutable `/apps` and mutable content boundaries                  |
| `aemaacs.all-embeds`          | warning     | `all` container references core deployment artifacts              |
| `aemaacs.repoinit`            | error       | RepoInit OSGi JSON and scripts shape                              |
| `catalog.author-only`         | error       | Catalog configuration and provisioning remain on Author           |
| `catalog.config`              | error       | v2 configuration and structural consistency                       |
| `catalog.generated-drift`     | warning     | Conflicts, stale owned output, and orphans                        |
| `component.require-dialog`    | warning     | Author dialog exists                                              |
| `component.require-readme`    | warning     | README documentation exists                                       |
| `component.require-thumbnail` | warning     | Thumbnail or configured layout fallback exists                    |
| `component.require-owner`     | warning     | Ownership metadata exists                                         |
| `component.require-status`    | warning     | Allowed lifecycle status exists                                   |
| `component.require-version`   | info        | Component version exists                                          |
| `component.minimum-quality`   | warning     | Explainable score meets `minimumQualityScore`                     |

`strict-aemaacs` promotes built-in warnings to errors before explicit `rules` overrides are applied.
