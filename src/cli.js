import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyPackageManagerCommand, normalizePackageManagerArgs } from "./package-managers.js";
import { loadConfig } from "./config.js";
import { detectCapabilities, formatCapabilities } from "./detect.js";
import { installGlobalShims, uninstallGlobalShims } from "./global-shims.js";
import { runGuard } from "./guard.js";
import { initProject } from "./init.js";
import { runOnboarding } from "./onboarding.js";
import { checkMinimumPackageAge } from "./package-age.js";
import { runDockerSandbox } from "./docker-backend.js";
import { formatReport } from "./report.js";
import { runVerifyLockfile } from "./verify-lockfile.js";

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

export async function runCli(args, context) {
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf8"));
    console.log(pkg.version);
    return;
  }

  if (command === "init") {
    const result = await initProject(context.cwd, args.slice(1), context.env);
    console.log(result.summary);
    return;
  }

  if (command === "onboarding") {
    const result = await runOnboarding(args.slice(1), context);
    console.log(result.summary);
    return;
  }

  if (command === "doctor") {
    const capabilities = detectCapabilities(context.env);
    console.log(formatCapabilities(capabilities));
    return;
  }

  if (command === "guard") {
    runGuard(args.slice(1), context);
    return;
  }

  if (command === "install-global-shims") {
    const result = await installGlobalShims(args.slice(1), context);
    console.log(result.message);
    return;
  }

  if (command === "uninstall-global-shims") {
    const result = await uninstallGlobalShims(args.slice(1), context);
    console.log(result.message);
    return;
  }

  if (command === "verify-lockfile") {
    await runVerifyLockfile(args.slice(1), context);
    return;
  }

  if (command === "ci") {
    await runVerifyLockfile(args.slice(1), context, { ci: true });
    return;
  }

  if (!PACKAGE_MANAGERS.has(command)) {
    throw new Error(`unknown command "${command}". Run "safe-install help".`);
  }

  await runPackageManagerGate(command, args.slice(1), context);
}

async function runPackageManagerGate(packageManager, rawArgs, context) {
  const options = parseRunOptions(rawArgs);
  const config = await loadConfig(context.cwd);
  const normalized = normalizePackageManagerArgs(packageManager, options.packageManagerArgs);
  const capabilities = detectCapabilities(context.env);

  if (config.sandbox.backend !== "docker") {
    throw new Error(`unsupported sandbox backend "${config.sandbox.backend}". Docker is the only implemented backend.`);
  }

  if (!capabilities.docker.available) {
    throw new Error("Docker daemon is unavailable. Run safe-install doctor for setup details.");
  }

  if (config.sandbox.minimumIsolation === "strong" && !capabilities.docker.available) {
    throw new Error("required isolation is strong, but Docker is unavailable.");
  }

  const packageAge = await checkMinimumPackageAge({
    packageManager,
    args: normalized.args,
    config,
  });

  if (packageAge.status === "blocked") {
    const report = {
      status: "blocked",
      packageManager,
      command: [packageManager, ...normalized.args],
      sandbox: {
        backend: config.sandbox.backend,
        isolation: "not-run",
        networkDuringBuild: config.sandbox.networkDuringBuild,
        realSecretsMounted: false,
        realProjectMounted: false,
      },
      phases: [],
      changedFiles: [],
      suspiciousWrites: [],
      notes: ["Sandbox was not started because package age policy blocked the request."],
      packageAge,
    };

    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatReport(report));
    process.exitCode = 2;
    return;
  }

  const report = await runDockerSandbox({
    cwd: context.cwd,
    packageManager,
    packageManagerArgs: normalized.args,
    config,
    onProgress: options.json ? null : (message) => console.error(`[safe-install] ${message}`),
    streamOutput: options.json ? null : ({ phaseName, stream, chunk }) => {
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) {
        if (line.length > 0) console.error(`[safe-install:${phaseName}:${stream}] ${line}`);
      }
    },
  });
  report.packageAge = packageAge;

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  if (report.status !== "passed") {
    process.exitCode = 2;
    return;
  }

  if (!options.apply) {
    if (!options.json) {
      console.log("\nDry run only. Re-run with --apply to update the real project with scripts disabled.");
    }
    return;
  }

  const applyResult = applyPackageManagerCommand({
    cwd: context.cwd,
    packageManager,
    args: normalized.args,
    env: context.env,
  });

  if (applyResult.status !== 0) {
    process.exitCode = applyResult.status || 1;
    return;
  }

  if (!options.json) {
    console.log("\nApplied to real project with install scripts disabled.");
  }
}

function parseRunOptions(args) {
  const packageManagerArgs = [];
  let apply = false;
  let json = false;

  for (const arg of args) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--json") {
      json = true;
    } else {
      packageManagerArgs.push(arg);
    }
  }

  if (packageManagerArgs.length === 0) {
    throw new Error("missing package manager command, for example: safe-install npm install lodash");
  }

  return { apply, json, packageManagerArgs };
}

function printHelp() {
  console.log(`safe-install

Usage:
  safe-install init [--agents] [--enforce]
  safe-install onboarding [--dry-run] [--defaults]
  safe-install doctor
  safe-install guard <npm|pnpm|yarn|bun>
  safe-install install-global-shims [--apply]
  safe-install uninstall-global-shims [--apply]
  safe-install verify-lockfile [--base <ref>] [--json]
  safe-install ci [--base <ref>] [--json]
  safe-install npm install <pkg> [--apply] [--json]
  safe-install pnpm update <pkg> [--apply] [--json]
  safe-install yarn add <pkg> [--apply] [--json]
  safe-install bun add <pkg> [--apply] [--json]

Default behavior is a Docker sandbox dry run. The real project is changed only with --apply.
`);
}
