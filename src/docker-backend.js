import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
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

export async function runDockerSandbox({ cwd, packageManager, packageManagerArgs, config }) {
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
    skippedPaths: [],
    notes: [
      "Package download/resolve runs with install scripts disabled.",
      "Lifecycle/build script detonation runs in a second Docker container with --network none.",
      "Apply mode updates the real project with install scripts disabled.",
    ],
  };

  try {
    const copyState = await copyProjectForSandbox(cwd, workspace);
    report.copiedBytes = copyState.copiedBytes;
    report.skippedPaths = copyState.skipped;
    await createFakeHome(home);

    const before = await snapshotTrackedFiles(workspace);
    const sensitiveBefore = await snapshotSensitivePaths(workspace, home);

    const installCommand = [
      def.bootstrap,
      "cd /workspace",
      shellQuote(def.sandboxInstall(packageManagerArgs)),
    ].filter(Boolean).join(" && ");

    const installPhase = runDocker({
      image,
      workspace,
      home,
      networkNone: false,
      memory: config.sandbox.docker.memory,
      pidsLimit: config.sandbox.docker.pidsLimit,
      script: installCommand,
    });
    report.phases.push({ name: "resolve-and-fetch", ...summarizeProcess(installPhase) });

    if (installPhase.status !== 0) {
      report.status = "failed";
      return report;
    }

    const rebuildCommand = [
      def.bootstrap,
      "cd /workspace",
      shellQuote(def.sandboxRebuild()),
    ].filter(Boolean).join(" && ");

    const rebuildPhase = runDocker({
      image,
      workspace,
      home,
      networkNone: true,
      memory: config.sandbox.docker.memory,
      pidsLimit: config.sandbox.docker.pidsLimit,
      script: rebuildCommand,
    });
    report.phases.push({ name: "offline-script-detonation", ...summarizeProcess(rebuildPhase) });

    if (rebuildPhase.status !== 0) {
      report.status = "failed";
    }

    const after = await snapshotTrackedFiles(workspace);
    const sensitiveAfter = await snapshotSensitivePaths(workspace, home);
    report.changedFiles = diffSnapshots(before, after);
    report.suspiciousWrites = diffSnapshots(sensitiveBefore, sensitiveAfter)
      .filter((entry) => entry.status !== "removed");

    if (report.suspiciousWrites.length > 0) {
      report.status = "blocked";
    }

    return report;
  } finally {
    if (!process.env.SAFE_INSTALL_KEEP_SANDBOX) {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }
}

function runDocker({ image, workspace, home, networkNone, memory, pidsLimit, script }) {
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

  return spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
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

async function createFakeHome(home) {
  await mkdir(join(home, ".ssh"), { recursive: true });
  await mkdir(join(home, ".aws"), { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(join(home, ".ssh", "id_rsa"), "SAFE_INSTALL_FAKE_SSH_KEY\n", { mode: 0o600 });
  await writeFile(join(home, ".npmrc"), "//registry.npmjs.org/:_authToken=SAFE_INSTALL_FAKE_NPM_TOKEN\n", { mode: 0o600 });
  await writeFile(join(home, ".aws", "credentials"), "SAFE_INSTALL_FAKE_AWS_CREDENTIALS\n", { mode: 0o600 });
  await writeFile(join(home, ".claude", "settings.json"), "{}\n");
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
