# Contributing

## Development

Use Node.js 20 or newer.

```bash
npm ci
npm run quality
npm run test:coverage
npm run test:integration
npm run compile
npm run package:vsix
```

## Pull requests

- Keep the product AEMaaCS-only.
- Add or update tests for policy, scanner, generator, configuration, or template changes.
- Preserve transactional and path-containment invariants.
- Do not weaken webview CSP or accept filesystem paths from webview messages.
- Document user-visible changes in `CHANGELOG.md`.
- Do not add telemetry or credential storage without an explicit security and privacy review.

Use Conventional Commit-style titles where practical. Breaking configuration changes require a migration and a major version.
