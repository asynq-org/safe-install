# Roadmap

## 0.1

- Docker sandbox backend.
- JavaScript and TypeScript package managers:
  - npm
  - pnpm
  - yarn
  - bun
- Dry-run install/update gate.
- Configurable minimum package age policy for direct dependencies.
- `--apply` mode with install scripts disabled.
- Agent instructions for Codex, Claude Code, Cursor, Copilot, and generic agents.
- Local package-manager shims.
- GitHub CI and generated changelog.
- Static landing page.

## 0.2

- Better lockfile diffing:
  - direct dependencies
  - transitive dependency changes
  - package age checks for transitive dependencies
  - newly introduced lifecycle scripts
  - package tarball integrity changes
- Structured JSON report schema.
- Policy allowlist for approved install scripts.
- First-class workspace support for monorepos.
- GitHub Action for PR enforcement.

## 0.3

- Stronger behavioral tracing:
  - file access tracing in Linux sandbox
  - network call audit
  - suspicious child process detection
  - canary secret exfiltration detection
- Podman backend.
- Lima/Colima guidance for macOS teams.

## 0.4

- Python support:
  - pip
  - uv
  - build backend execution detection
  - wheel/sdist policy

## 0.5

- Rust support:
  - cargo
  - build.rs detection
  - crates.io source verification
  - native build policy

## Later

- bubblewrap backend for Linux.
- firejail backend for Linux.
- macOS-specific isolation research.
- Optional local TUI report viewer.
- SBOM export.
- OpenSSF Scorecard and Sigstore integration.
