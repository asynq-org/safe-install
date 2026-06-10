# Security Model

`safe-install` reduces the blast radius of dependency installation and update workflows. It does not prove that a dependency is safe to execute at application runtime.

## Protected Assets

The Docker backend does not mount:

- real SSH keys
- real npm tokens
- real cloud credentials
- real shell profiles
- real Claude/Cursor/VS Code configuration
- the real project directory during detonation

## Blocked Behaviors

The offline detonation phase blocks network access at the Docker container level.

If an install/build script requires network access, the phase fails. This is intentional and should be reviewed explicitly.

## Expected False Positives

Legitimate packages may fail if they:

- download native binaries during install
- require online build steps
- depend on postinstall scripts with external calls
- assume access to a normal developer home directory

The project should prefer explicit policy allowlists over silent fallback.

## Reporting Vulnerabilities

Until this project has a dedicated security contact, open a private issue or contact the repository maintainer directly.
