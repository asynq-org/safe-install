# Architecture

`safe-install` is intentionally local-first. The CLI does not send package names, dependency graphs, lockfiles, reports, or telemetry to a remote service.

## Flow

```text
developer or agent
  -> safe-install <package-manager> <command>
  -> load safe-install.yaml
  -> detect sandbox capabilities
  -> copy project to temp workspace
  -> create fake HOME with canary placeholder files
  -> run package manager with scripts disabled
  -> run script detonation offline
  -> produce report
  -> optionally apply to real project with scripts disabled
```

## Docker Backend

The first backend uses Docker because it is the most practical cross-platform strong isolation layer for macOS and Linux teams.

The sandbox containers:

- mount a temporary project copy, not the real project
- mount a fake home directory, not the real home directory
- set `HOME=/safe-home`
- drop Linux capabilities with `--cap-drop=ALL`
- enable `no-new-privileges`
- set process and memory limits
- run build-script detonation with `--network none`

## Two-Phase Sandbox

Package managers need network access to fetch packages. Install scripts should not have network access.

The Docker backend therefore runs two phases:

1. `resolve-and-fetch`
   - network available
   - package scripts disabled
2. `offline-script-detonation`
   - network blocked
   - rebuild/build scripts executed in the sandbox

## Apply Mode

`--apply` never runs a normal raw install in the real project. It re-runs the package-manager command with scripts disabled.

This avoids the common failure mode where a tool performs a safe dry run and then executes the dangerous command for real.

## Current Detection Limits

The prototype reports:

- changed lockfiles and dependency metadata
- writes to sensitive project paths
- writes to fake home sensitive paths
- phase failures and package-manager output

The prototype does not yet provide:

- full syscall tracing
- exact read-attempt reports for every secret path
- egress destination audit beyond Docker network blocking
- malware classification

Future tracing work is tracked in [ROADMAP.md](../ROADMAP.md).
