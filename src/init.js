import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectCapabilities, formatCapabilities } from "./detect.js";
import { CONFIG_FILE, renderDefaultConfig } from "./config.js";

const SAFE_INSTALL_SECTION_START = "<!-- safe-install:start -->";
const SAFE_INSTALL_SECTION_END = "<!-- safe-install:end -->";

export async function initProject(cwd, args, env) {
  const agents = args.includes("--agents") || args.includes("--all");
  const enforce = args.includes("--enforce") || args.includes("--all");
  const packageJsonGuard = args.includes("--package-json-guard") || args.includes("--all");
  const capabilities = detectCapabilities(env);
  const written = [];

  await writeFile(join(cwd, CONFIG_FILE), renderDefaultConfig(), { flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
  });
  written.push(CONFIG_FILE);

  if (agents) {
    await writeAgentInstructions(cwd);
    written.push("AGENTS.md", "CLAUDE.md", ".cursor/rules/safe-install.mdc", ".github/copilot-instructions.md");
  }

  if (enforce) {
    await writeShims(cwd);
    written.push(".safe-install/bin/{npm,pnpm,yarn,bun}");
  }

  if (packageJsonGuard) {
    const changed = await writePackageJsonGuard(cwd);
    if (changed) {
      written.push("package.json preinstall guard");
    }
  }

  return {
    summary: [
      "Initialized safe-install policy.",
      "",
      formatCapabilities(capabilities),
      "",
      "Written:",
      ...written.map((item) => `- ${item}`),
      "",
      enforce
        ? 'Add this to agent/dev shell PATH before package manager commands: export PATH="$PWD/.safe-install/bin:$PATH"'
        : "Run safe-install init --agents --enforce to add agent instructions and package manager shims.",
      packageJsonGuard
        ? "package.json preinstall guard is enabled for raw install warnings."
        : "Run safe-install init --package-json-guard to add a lightweight preinstall guard.",
    ].join("\n"),
  };
}

export async function writeAgentInstructions(cwd) {
  await mkdir(join(cwd, ".cursor", "rules"), { recursive: true });
  await mkdir(join(cwd, ".github"), { recursive: true });

  await upsertManagedSection(join(cwd, "AGENTS.md"), agentInstructionText("AGENTS.md"));
  await upsertManagedSection(join(cwd, "CLAUDE.md"), agentInstructionText("CLAUDE.md"));
  await upsertManagedSection(join(cwd, ".cursor", "rules", "safe-install.mdc"), cursorInstructionText());
  await upsertManagedSection(join(cwd, ".github", "copilot-instructions.md"), agentInstructionText("GitHub Copilot"));
}

function agentInstructionText(target) {
  return `## Dependency Installation Policy

This repository uses safe-install. These instructions apply to ${target} and all AI coding agents.

Never run npm, pnpm, yarn, or bun directly when installing, updating, or removing JavaScript/TypeScript dependencies.

Use safe-install:

\`\`\`bash
safe-install npm install <pkg>
safe-install npm update <pkg>
safe-install pnpm add <pkg>
safe-install pnpm update <pkg>
safe-install yarn add <pkg>
safe-install bun add <pkg>
\`\`\`

Run dry checks with --dry-run when you only need a risk report.

If a raw package manager command is blocked by a shim, retry through safe-install. Do not bypass the policy unless the human maintainer explicitly approves it.
`;
}

function cursorInstructionText() {
  return `---
description: Enforce safe dependency installation
alwaysApply: true
---

When installing, updating, or removing JavaScript/TypeScript dependencies, never run npm, pnpm, yarn, or bun directly.

Use safe-install for real project changes. Use --dry-run for inspection.
`;
}

async function upsertManagedSection(path, sectionText) {
  const managedSection = `${SAFE_INSTALL_SECTION_START}\n${sectionText.trim()}\n${SAFE_INSTALL_SECTION_END}\n`;
  let existing;

  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path, managedSection);
    return true;
  }

  if (existing.includes(SAFE_INSTALL_SECTION_START) && existing.includes(SAFE_INSTALL_SECTION_END)) {
    const pattern = new RegExp(`${escapeRegExp(SAFE_INSTALL_SECTION_START)}[\\s\\S]*?${escapeRegExp(SAFE_INSTALL_SECTION_END)}\\n?`);
    const next = existing.replace(pattern, managedSection);
    if (next !== existing) {
      await writeFile(path, next);
      return true;
    }
    return false;
  }

  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(path, `${existing}${separator}${managedSection}`);
  return true;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function writeShims(cwd) {
  const binDir = join(cwd, ".safe-install", "bin");
  await mkdir(binDir, { recursive: true });
  for (const pm of ["npm", "pnpm", "yarn", "bun"]) {
    const path = join(binDir, pm);
    await writeFile(path, shimText(pm), { mode: 0o755 });
  }
  await ensureGitignoreEntry(cwd, ".safe-install/");
}

async function ensureGitignoreEntry(cwd, entry) {
  const path = join(cwd, ".gitignore");
  let existing = "";

  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(entry)) return false;

  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${existing}${prefix}${entry}\n`);
  return true;
}

function shimText(packageManager) {
  return `#!/usr/bin/env sh
set -eu

if [ "\${SAFE_INSTALL_INTERNAL_APPLY:-}" = "1" ]; then
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
  exec ${packageManager} "$@"
fi

echo "safe-install policy: do not run ${packageManager} directly in this repository." >&2
echo "Use: safe-install ${packageManager} $*" >&2
exit 99
`;
}

export async function writePackageJsonGuard(cwd) {
  const path = join(cwd, "package.json");
  let pkg;

  try {
    pkg = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }

  pkg.scripts = pkg.scripts || {};
  if (pkg.scripts.preinstall === "safe-install guard npm") {
    return false;
  }

  if (pkg.scripts.preinstall) {
    pkg.scripts.preinstall = `safe-install guard npm && ${pkg.scripts.preinstall}`;
  } else {
    pkg.scripts.preinstall = "safe-install guard npm";
  }

  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}
