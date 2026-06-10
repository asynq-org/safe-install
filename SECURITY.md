# Security Policy

`safe-install` is an early security tool. Please do not publish exploit details for bypasses or sandbox escapes before maintainers have had a chance to respond.

## Reporting

Open a private security advisory on GitHub when the repository is published, or contact the maintainer directly until advisories are enabled.

## Scope

In scope:

- sandbox escapes
- unsafe environment or secret propagation into Docker
- raw package-manager execution when safe-install claims scripts are disabled
- global shim recursion or bypasses that are not documented
- incorrect lockfile verification that allows policy violations

Out of scope:

- malicious runtime behavior after an application imports an installed dependency
- packages that require network access during install and are intentionally blocked
