import { spawnSync } from "node:child_process";

export const PACKAGE_MANAGER_DEFS = Object.freeze({
  npm: {
    realApplyArgs(args) {
      return appendMissing(args, "--ignore-scripts");
    },
    sandboxInstall(args) {
      return ["npm", ...appendMissing(args, "--ignore-scripts")];
    },
    sandboxRebuild() {
      return ["npm", "rebuild", "--foreground-scripts"];
    },
    bootstrap: "",
    dockerImageKind: "node",
  },
  pnpm: {
    realApplyArgs(args) {
      return appendMissing(args, "--ignore-scripts");
    },
    sandboxInstall(args) {
      return ["pnpm", ...appendMissing(args, "--ignore-scripts")];
    },
    sandboxRebuild() {
      return ["pnpm", "rebuild"];
    },
    bootstrap: "corepack enable pnpm >/dev/null 2>&1 || true",
    dockerImageKind: "node",
  },
  yarn: {
    realApplyArgs(args) {
      return appendMissing(args, "--ignore-scripts");
    },
    sandboxInstall(args) {
      return ["yarn", ...appendMissing(args, "--ignore-scripts")];
    },
    sandboxRebuild() {
      return ["yarn", "install", "--offline"];
    },
    bootstrap: "corepack enable yarn >/dev/null 2>&1 || true",
    dockerImageKind: "node",
  },
  bun: {
    realApplyArgs(args) {
      return appendMissing(args, "--ignore-scripts");
    },
    sandboxInstall(args) {
      return ["bun", ...appendMissing(args, "--ignore-scripts")];
    },
    sandboxRebuild() {
      return ["bun", "install", "--offline"];
    },
    bootstrap: "",
    dockerImageKind: "bun",
  },
});

export function normalizePackageManagerArgs(packageManager, args) {
  if (!PACKAGE_MANAGER_DEFS[packageManager]) {
    throw new Error(`unsupported package manager "${packageManager}"`);
  }
  return { args };
}

export function applyPackageManagerCommand({ cwd, packageManager, args, env }) {
  const def = PACKAGE_MANAGER_DEFS[packageManager];
  const applyArgs = def.realApplyArgs(args);
  const result = spawnSync(packageManager, applyArgs, {
    cwd,
    env: {
      ...env,
      SAFE_INSTALL_INTERNAL_APPLY: "1",
    },
    stdio: "inherit",
  });

  return {
    status: result.status,
    signal: result.signal,
  };
}

export function appendMissing(args, flag) {
  return args.includes(flag) ? args : [...args, flag];
}

export function shellQuote(args) {
  return args.map((arg) => `'${String(arg).replaceAll("'", "'\\''")}'`).join(" ");
}
