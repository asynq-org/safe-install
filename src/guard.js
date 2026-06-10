const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

export function runGuard(args, context) {
  const packageManager = args[0];
  if (!PACKAGE_MANAGERS.has(packageManager)) {
    throw new Error("guard requires a package manager: safe-install guard <npm|pnpm|yarn|bun>");
  }

  if (
    context.env.SAFE_INSTALL_INTERNAL_APPLY === "1" ||
    context.env.SAFE_INSTALL_SANDBOX === "1" ||
    context.env.SAFE_INSTALL_GUARD_BYPASS === "1"
  ) {
    return;
  }

  const lines = [
    `safe-install guard blocked raw ${packageManager} install.`,
    "",
    "This repository requires dependency changes to go through safe-install.",
    "",
    "Use one of:",
    `  safe-install ${packageManager} install <pkg> --apply`,
    `  safe-install ${packageManager} update <pkg> --apply`,
    "",
    "For a dry risk report, omit --apply.",
    "",
    "Maintainer-only emergency bypass:",
    `  SAFE_INSTALL_GUARD_BYPASS=1 ${packageManager} install`,
  ];

  console.error(lines.join("\n"));
  process.exitCode = 99;
}
