# Agent Instructions

This repository contains `safe-install`, a local-first dependency installation gate for JavaScript and TypeScript projects.

## Dependency Changes

Do not run raw dependency-changing package manager commands in this repository.

Use the local CLI when dependency changes are necessary:

```bash
node bin/safe-install.js npm install <package>
node bin/safe-install.js pnpm add <package>
node bin/safe-install.js yarn add <package>
node bin/safe-install.js bun add <package>
```

Use `--dry-run` when the user asks for investigation only. The real project is changed only after the safe-install report passes.

## Development Checks

Before finishing code changes, run:

```bash
npm test
```

For changes touching Docker sandbox behavior, run the Docker E2E suite when Docker is available:

```bash
SAFE_INSTALL_E2E=1 npm test
```

## Release Safety

Do not publish to npm, create release tags, or modify release automation unless the user explicitly asks.

The release workflow publishes from GitHub Actions. Do not add npm tokens to repository files or workflow files.

## Public Documentation

Keep `README.md` and the landing page product-facing. Do not add maintainer-only setup notes, one-off operational instructions, or internal troubleshooting details to public documentation unless the user asks for them.

Use `docs/` for durable technical documentation and keep public claims conservative. Avoid claiming malware detection unless the implementation actually supports the stated behavior.

## Scope

Keep changes focused. Prefer existing modules and patterns over new abstractions. Do not rewrite unrelated files or reformat the repository without a concrete reason.
