import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { copyProjectForSandbox } from "./project-copy.js";
import { PACKAGE_MANAGER_DEFS, shellQuote } from "./package-managers.js";

const TRACKED_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

const SENSITIVE_PATHS = [
  ".claude",
  ".cursor",
  ".vscode",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
];

export async function runDockerSandbox({ cwd, packageManager, packageManagerArgs, config, onProgress, streamOutput }) {
  const startedAt = performance.now();
  const def = PACKAGE_MANAGER_DEFS[packageManager];
  const sandboxRoot = await mkdtemp(join(tmpdir(), "safe-install-"));
  const workspace = join(sandboxRoot, "workspace");
  const home = join(sandboxRoot, "home");
  const image = def.dockerImageKind === "bun"
    ? config.sandbox.docker.bunImage
    : config.sandbox.docker.nodeImage;

  const report = {
    status: "passed",
    packageManager,
    command: [packageManager, ...packageManagerArgs],
    sandbox: {
      backend: "docker",
      image,
      isolation: "strong",
      networkDuringBuild: "blocked",
      realSecretsMounted: false,
      realProjectMounted: false,
    },
    phases: [],
    changedFiles: [],
    suspiciousWrites: [],
    copiedBytes: 0,
    durationSeconds: 0,
    skippedPaths: [],
    notes: [
      "Package download/resolve runs with install scripts disabled.",
      "Lifecycle/build script detonation runs in a second Docker container with --network none.",
      "Apply mode updates the real project with install scripts disabled.",
    ],
  };

  try {
    onProgress?.("Preparing isolated Docker workspace.");
    const copyState = await copyProjectForSandbox(cwd, workspace);
    report.copiedBytes = copyState.copiedBytes;
    report.skippedPaths = copyState.skipped;
    await createFakeHome(home);
    const removedGuards = await removeSandboxOnlyPackageJsonGuards(workspace);
    if (removedGuards.length > 0) {
      report.notes.push(`Ignored sandbox-only safe-install guard script(s): ${removedGuards.join(", ")}.`);
    }
    onProgress?.(`Copied project into sandbox (${formatBytes(copyState.copiedBytes)}).`);

    const before = await snapshotTrackedFiles(workspace);
    const sensitiveBefore = await snapshotSensitivePaths(workspace, home);

    const installCommand = [
      def.bootstrap,
      "cd /workspace",
      shellQuote(def.sandboxInstall(packageManagerArgs)),
    ].filter(Boolean).join(" && ");

    onProgress?.("Running resolve-and-fetch phase with lifecycle scripts disabled.");
    const installPhase = await runDocker({
      phaseName: "resolve-and-fetch",
      image,
      workspace,
      home,
      networkNone: false,
      memory: config.sandbox.docker.memory,
      pidsLimit: config.sandbox.docker.pidsLimit,
      script: installCommand,
      streamOutput,
    });
    report.phases.push({ name: "resolve-and-fetch", ...summarizeProcess(installPhase) });

    if (installPhase.status !== 0) {
      onProgress?.(`resolve-and-fetch failed with exit code ${installPhase.status}.`);
      report.status = "failed";
      report.durationSeconds = elapsedSeconds(startedAt);
      return report;
    }
    onProgress?.("resolve-and-fetch completed.");

    const rebuildCommand = [
      def.bootstrap,
      "cd /workspace",
      shellQuote(def.sandboxRebuild()),
    ].filter(Boolean).join(" && ");

    onProgress?.("Running offline-script-detonation phase with Docker network disabled.");
    const rebuildPhase = await runDocker({
      phaseName: "offline-script-detonation",
      image,
      workspace,
      home,
      networkNone: true,
      memory: config.sandbox.docker.memory,
      pidsLimit: config.sandbox.docker.pidsLimit,
      script: rebuildCommand,
      streamOutput,
    });
    report.phases.push({ name: "offline-script-detonation", ...summarizeProcess(rebuildPhase) });

    if (rebuildPhase.status !== 0) {
      onProgress?.(`offline-script-detonation failed with exit code ${rebuildPhase.status}.`);
      report.status = "failed";
    } else {
      onProgress?.("offline-script-detonation completed.");
    }

    const after = await snapshotTrackedFiles(workspace);
    const sensitiveAfter = await snapshotSensitivePaths(workspace, home);
    report.changedFiles = diffSnapshots(before, after);
    report.suspiciousWrites = diffSnapshots(sensitiveBefore, sensitiveAfter)
      .filter((entry) => entry.status !== "removed");

    if (report.suspiciousWrites.length > 0) {
      report.status = "blocked";
      onProgress?.(`Blocked: detected ${report.suspiciousWrites.length} suspicious write(s).`);
    }

    onProgress?.("Sandbox analysis complete.");
    report.durationSeconds = elapsedSeconds(startedAt);
    return report;
  } finally {
    if (!process.env.SAFE_INSTALL_KEEP_SANDBOX) {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }
}

function runDocker({ phaseName, image, workspace, home, networkNone, memory, pidsLimit, script, streamOutput }) {
  const args = [
    "run",
    "--rm",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(pidsLimit),
    "--memory",
    memory,
    "-e",
    "HOME=/safe-home",
    "-e",
    "CI=1",
    "-e",
    "SAFE_INSTALL_SANDBOX=1",
    "-v",
    `${workspace}:/workspace`,
    "-v",
    `${home}:/safe-home`,
    "-w",
    "/workspace",
  ];

  if (networkNone) {
    args.push("--network", "none");
  }

  args.push(image, "/bin/sh", "-lc", script);

  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      streamOutput?.({ phaseName, stream: "stdout", chunk });
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      streamOutput?.({ phaseName, stream: "stderr", chunk });
    });

    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function summarizeProcess(result) {
  return {
    status: result.status,
    signal: result.signal,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
  };
}

function trimOutput(value) {
  const text = value || "";
  return text.length > 4000 ? `${text.slice(0, 4000)}\n[truncated]` : text;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function elapsedSeconds(startedAt) {
  return Math.round(((performance.now() - startedAt) / 1000) * 10) / 10;
}

async function createFakeHome(home) {
  await mkdir(join(home, ".ssh"), { recursive: true });
  await mkdir(join(home, ".aws"), { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(join(home, ".ssh", "id_rsa"), "SAFE_INSTALL_FAKE_SSH_KEY\n", { mode: 0o600 });
  await writeFile(join(home, ".npmrc"), "//registry.npmjs.org/:_authToken=SAFE_INSTALL_FAKE_NPM_TOKEN\n", { mode: 0o600 });
  await writeFile(join(home, ".aws", "credentials"), "SAFE_INSTALL_FAKE_AWS_CREDENTIALS\n", { mode: 0o600 });
  await writeFile(join(home, ".claude", "settings.json"), "{}\n");
}

async function removeSandboxOnlyPackageJsonGuards(workspace) {
  const path = join(workspace, "package.json");
  let pkg;

  try {
    pkg = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }

  if (!pkg.scripts || typeof pkg.scripts !== "object") return [];

  const removed = [];
  for (const scriptName of ["preinstall"]) {
    const value = pkg.scripts[scriptName];
    if (typeof value !== "string") continue;

    const next = removeLeadingSafeInstallGuard(value);
    if (next === value) continue;

    removed.push(scriptName);
    if (next) pkg.scripts[scriptName] = next;
    else delete pkg.scripts[scriptName];
  }

  if (removed.length > 0) {
    await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return removed;
}

function removeLeadingSafeInstallGuard(script) {
  return script
    .replace(/^safe-install\s+guard\s+(npm|pnpm|yarn|bun)\s*&&\s*/, "")
    .replace(/^safe-install\s+guard\s+(npm|pnpm|yarn|bun)\s*$/, "");
}

async function snapshotTrackedFiles(root) {
  const snapshot = {};
  for (const file of TRACKED_FILES) {
    const path = join(root, file);
    try {
      snapshot[file] = await readFile(path, "utf8");
    } catch {
      snapshot[file] = null;
    }
  }
  return snapshot;
}

async function snapshotSensitivePaths(workspace, home) {
  const snapshot = {};
  for (const base of [workspace, home]) {
    for (const path of SENSITIVE_PATHS) {
      await snapshotPath(join(base, path), relative(workspace, join(base, path)), snapshot);
    }
  }
  return snapshot;
}

async function snapshotPath(path, label, snapshot) {
  let info;
  try {
    info = await stat(path);
  } catch {
    snapshot[label] = null;
    return;
  }

  if (info.isFile()) {
    snapshot[label] = await readFile(path, "utf8").catch(() => "<binary>");
    return;
  }

  if (!info.isDirectory()) return;

  const entries = await readdir(path);
  snapshot[label] = "<directory>";
  for (const entry of entries) {
    await snapshotPath(join(path, entry), `${label}/${entry}`, snapshot);
  }
}

function diffSnapshots(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of [...keys].sort()) {
    if (before[key] === after[key]) continue;
    changes.push({
      path: key,
      status: before[key] === null ? "added" : after[key] === null ? "removed" : "modified",
    });
  }
  return changes;
}
