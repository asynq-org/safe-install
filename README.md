# safe-install

Local-first safe dependency install gate for JavaScript and TypeScript repositories.

`safe-install` wraps package-manager installs and updates in a Docker sandbox before anything touches the real project. It is built for teams and AI coding agents that should not run raw `npm install`, `pnpm update`, `yarn add`, or `bun add` directly.

No dashboard. No telemetry. No dependency graph upload.

## Status

Early prototype. Docker is the first implemented sandbox backend. The current implementation isolates install-time code from your real project and real home directory, but it does not yet provide full syscall-level audit such as exact read attempts for every secret path.

## Why

Modern supply-chain attacks increasingly execute during dependency installation through lifecycle scripts, build hooks, native build files, or package-manager side effects. Classic dependency scanners mostly ask:

> Is this package known to be bad?

`safe-install` asks a different question:

> What happens when this dependency change is installed?

## Install

Install in a project:

```bash
npm install -D @asynq.org/safe-install
```

For local development from this repository:

```bash
npm link
```

Then initialize a project:

```bash
safe-install onboarding
```

The onboarding flow asks what to enable:

- project policy in `safe-install.yaml`
- AI agent instructions
- repo-local package-manager shims
- lightweight `package.json` guard
- optional global shims
- package age and install-script policy

Preview the choices without writing files:

```bash
safe-install onboarding --dry-run
```

Use defaults without prompts:

```bash
safe-install onboarding --defaults
```

Manual project setup is still available:

```bash
safe-install init --agents --enforce
```

Optional lightweight `package.json` guard when configuring manually:

```bash
safe-install init --package-json-guard
```

This adds a `preinstall` script that prints a clear error when someone runs a raw install instead of `safe-install`. It is a guardrail, not hard enforcement, because `--ignore-scripts` can bypass it.

Minimum package age protection is enabled by default at 48 hours. Set `policy.minimumPackageAgeHours` to `168` for a one-week cool-down.

## Usage

Dry run first:

```bash
safe-install npm install lodash
safe-install pnpm update react
safe-install yarn add zod
safe-install bun add hono
```

Apply only after the sandbox passes:

```bash
safe-install npm install lodash --apply
```

The default flow is:

1. Copy the project into a temporary sandbox workspace.
2. Use a fake `HOME` containing only canary placeholder files.
3. Resolve and fetch dependencies with package scripts disabled.
4. Run rebuild/build-script detonation in a second Docker container with `--network none`.
5. Report changed dependency files and suspicious writes.
6. With `--apply`, update the real project with install scripts disabled.

## Supported Package Managers

Initial JavaScript and TypeScript support:

- `npm`
- `pnpm`
- `yarn`
- `bun`

Python and Rust are planned. See [ROADMAP.md](ROADMAP.md).

## Agent Enforcement

`safe-install init --agents --enforce` writes:

- `AGENTS.md`
- `CLAUDE.md`
- `.cursor/rules/safe-install.mdc`
- `.github/copilot-instructions.md`
- `.safe-install/bin/npm`
- `.safe-install/bin/pnpm`
- `.safe-install/bin/yarn`
- `.safe-install/bin/bun`

Add the shim directory before normal package managers:

```bash
export PATH="$PWD/.safe-install/bin:$PATH"
```

Raw package-manager commands will be blocked with a message telling the agent to use `safe-install`.

See [docs/AI_AGENTS.md](docs/AI_AGENTS.md) for the agent policy and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the sandbox flow.

## package.json Guard

For projects that do not want shell hooks or global shims, `safe-install init --package-json-guard` adds:

```json
{
  "scripts": {
    "preinstall": "safe-install guard npm"
  }
}
```

Raw `npm install` prints:

```text
safe-install guard blocked raw npm install.
This repository requires dependency changes to go through safe-install.
```

This guard is intentionally lightweight. It cannot stop installs run with `--ignore-scripts`; use CI for team enforcement.

## Global Shims

For developers who want normal package-manager commands protected across repositories, use optional global shims.

Dry run:

```bash
safe-install install-global-shims
```

Apply:

```bash
safe-install install-global-shims --apply
```

Then add the shim directory before normal package managers:

```bash
export PATH="$HOME/.safe-install/shims:$PATH"
```

Behavior:

- inside a repository with `safe-install.yaml`, dependency-changing commands are routed through `safe-install`
- outside such repositories, commands delegate to the real package manager
- non-dependency commands such as `npm view`, `npm publish`, `npm login`, `npm config`, and `npm run` delegate unchanged

Uninstall dry run:

```bash
safe-install uninstall-global-shims
```

Uninstall apply:

```bash
safe-install uninstall-global-shims --apply
```

Emergency bypass:

```bash
SAFE_INSTALL_GLOBAL_SHIM_BYPASS=1 npm install
```

## Configuration

`safe-install init` writes `safe-install.yaml`:

```yaml
sandbox:
  backend: docker
  minimumIsolation: strong
  networkDuringBuild: blocked
  allowFallback: false
  docker:
    nodeImage: node:22-bookworm-slim
    bunImage: oven/bun:1
    memory: 2g
    pidsLimit: 256

policy:
  minimumPackageAgeHours: 48
  blockUnverifiedPackageAge: false
  blockNewInstallScripts: true
  allowedInstallScriptPackages: []
  npmRegistry: https://registry.npmjs.org
```

The important default is `allowFallback: false`. If strong isolation is required and Docker is unavailable, the install is blocked instead of silently degrading to a weaker mode.

`policy.minimumPackageAgeHours` blocks freshly published direct dependency versions. Set it to `168` for one week, or `0` to disable the age gate.

Set `blockUnverifiedPackageAge: true` if private or unverifiable package metadata should block instead of warn.

Private or custom-registry packages are automatically allowed by the package-age policy in this prototype.

`blockNewInstallScripts: true` blocks newly introduced install/build scripts found in parsed lockfile changes unless the package is listed in `allowedInstallScriptPackages`.

## CI

Verify dependency changes in pull requests:

```bash
safe-install verify-lockfile --base origin/main
```

CI entrypoint:

```bash
safe-install ci --base origin/main
```

Both commands support `--json`. `ci` also requires Docker daemon availability because CI should enforce that the sandbox backend is usable.

## Threat Model

What this prototype protects:

- Real SSH keys are not mounted.
- Real npm tokens are not mounted.
- Real cloud credentials are not mounted.
- Real Claude/Cursor/VS Code config is not mounted.
- Real project files are not mounted during detonation.
- Build/lifecycle script detonation runs with Docker `--network none`.

What it does not yet claim:

- Full syscall audit.
- Complete detection of secret read attempts.
- Kernel-level containment beyond Docker's configured isolation.
- Protection from malicious runtime code after you import and execute a dependency in your app.

The goal is to reduce install/update blast radius, not prove arbitrary dependency code is safe.

## Development

```bash
npm test
SAFE_INSTALL_E2E=1 npm test
npm run changelog
```

`SAFE_INSTALL_E2E=1` enables Docker-backed end-to-end tests. They are skipped by default when Docker is unavailable.

## Contributing

Pull requests are welcome.

Good first contributions include package-manager edge cases, lockfile parsing improvements, CI annotations, documentation, and additional sandbox backends from the roadmap.

Before opening a PR, run:

```bash
npm test
```

For changes touching Docker sandbox behavior, also run:

```bash
SAFE_INSTALL_E2E=1 npm test
```

## License

Copyright 2026 [Asynq Security](https://asynq.org). Author: Asynq Root <root@asynq.org>.

Licensed under the [Apache License 2.0](LICENSE).
