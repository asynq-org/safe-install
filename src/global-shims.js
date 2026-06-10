import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"];

export function globalShimDir(env = process.env) {
  const home = env.HOME || env.USERPROFILE;
  if (!home) {
    throw new Error("cannot determine home directory for global shims");
  }
  return join(home, ".safe-install", "shims");
}

export async function installGlobalShims(args, context) {
  const apply = args.includes("--apply");
  const dir = globalShimDir(context.env);
  const actions = PACKAGE_MANAGERS.map((pm) => ({
    action: "write",
    path: join(dir, pm),
    packageManager: pm,
  }));

  if (apply) {
    await mkdir(dir, { recursive: true });
    for (const item of actions) {
      await writeFile(item.path, renderGlobalShim(item.packageManager), { mode: 0o755 });
    }
  }

  return {
    apply,
    dir,
    actions,
    message: formatGlobalShimPlan({
      title: apply ? "Installed global safe-install shims." : "Dry run: global safe-install shims would be installed.",
      dir,
      actions,
      apply,
    }),
  };
}

export async function uninstallGlobalShims(args, context) {
  const apply = args.includes("--apply");
  const dir = globalShimDir(context.env);
  const actions = PACKAGE_MANAGERS.map((pm) => ({
    action: "remove",
    path: join(dir, pm),
    packageManager: pm,
  }));

  if (apply) {
    for (const item of actions) {
      await rm(item.path, { force: true });
    }
  }

  return {
    apply,
    dir,
    actions,
    message: formatGlobalShimPlan({
      title: apply ? "Removed global safe-install shims." : "Dry run: global safe-install shims would be removed.",
      dir,
      actions,
      apply,
      uninstall: true,
    }),
  };
}

function formatGlobalShimPlan({ title, dir, actions, apply, uninstall = false }) {
  const lines = [
    title,
    "",
    `Shim directory: ${dir}`,
    "",
    "Actions:",
    ...actions.map((item) => `- ${item.action}: ${item.path}`),
  ];

  if (!uninstall) {
    lines.push(
      "",
      "Add this directory before normal package managers:",
      '  export PATH="$HOME/.safe-install/shims:$PATH"',
      "",
      "Behavior:",
      "- inside a repository with safe-install.yaml, dependency-changing commands are routed through safe-install",
      "- outside such repositories, commands delegate to the real package manager",
      "- non-dependency commands such as view, publish, login, config, and run delegate unchanged",
    );
  }

  if (!apply) {
    lines.push("", "No files were changed. Re-run with --apply to execute this plan.");
  }

  return lines.join("\n");
}

function renderGlobalShim(packageManager) {
  return `#!/usr/bin/env sh
set -eu

pm="${packageManager}"

if [ "\${SAFE_INSTALL_INTERNAL_APPLY:-}" = "1" ] || [ "\${SAFE_INSTALL_GLOBAL_SHIM_BYPASS:-}" = "1" ]; then
  shim_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  new_path=""
  old_ifs=$IFS
  IFS=:
  for part in $PATH; do
    if [ "$part" != "$shim_dir" ]; then
      if [ -z "$new_path" ]; then
        new_path="$part"
      else
        new_path="$new_path:$part"
      fi
    fi
  done
  IFS=$old_ifs
  PATH=$new_path
  export PATH
  exec "$pm" "$@"
fi

find_safe_install_root() {
  dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/safe-install.yaml" ]; then
      printf '%s\\n' "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

is_dependency_command() {
  cmd="\${1:-}"
  case "$pm:$cmd" in
    npm:install|npm:i|npm:update|npm:up|npm:uninstall|npm:remove|npm:rm|npm:ci)
      return 0
      ;;
    pnpm:add|pnpm:install|pnpm:i|pnpm:update|pnpm:up|pnpm:remove|pnpm:rm)
      return 0
      ;;
    yarn:add|yarn:install|yarn:up|yarn:upgrade|yarn:remove)
      return 0
      ;;
    bun:add|bun:install|bun:update|bun:remove)
      return 0
      ;;
  esac
  return 1
}

if root=$(find_safe_install_root) && is_dependency_command "\${1:-}"; then
  case " $* " in
    *" --apply "*) exec safe-install "$pm" "$@" ;;
    *) exec safe-install "$pm" "$@" --apply ;;
  esac
fi

shim_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
new_path=""
old_ifs=$IFS
IFS=:
for part in $PATH; do
  if [ "$part" != "$shim_dir" ]; then
    if [ -z "$new_path" ]; then
      new_path="$part"
    else
      new_path="$new_path:$part"
    fi
  fi
done
IFS=$old_ifs
PATH=$new_path
export PATH
exec "$pm" "$@"
`;
}
