# AI Agent Policy

AI coding agents must use `safe-install` for JavaScript and TypeScript dependency changes.

## Required Rule

Agents must not run these commands directly:

```bash
npm install
npm update
npm uninstall
pnpm add
pnpm update
pnpm remove
yarn add
yarn remove
bun add
bun remove
```

Agents must run:

```bash
safe-install npm install <pkg> --apply
safe-install npm update <pkg> --apply
safe-install pnpm add <pkg> --apply
safe-install pnpm update <pkg> --apply
safe-install yarn add <pkg> --apply
safe-install bun add <pkg> --apply
```

Use dry runs without `--apply` for investigation.

## Generated Files

`safe-install init --agents` writes:

- `AGENTS.md`
- `CLAUDE.md`
- `.cursor/rules/safe-install.mdc`
- `.github/copilot-instructions.md`

## Enforcement Shims

`safe-install init --enforce` writes local package-manager shims:

```text
.safe-install/bin/npm
.safe-install/bin/pnpm
.safe-install/bin/yarn
.safe-install/bin/bun
```

Add the shim path before normal package managers:

```bash
export PATH="$PWD/.safe-install/bin:$PATH"
```

This makes accidental raw package-manager commands fail fast.
