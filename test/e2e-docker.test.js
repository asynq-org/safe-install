import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const dockerAvailable = spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0;
const runE2E = process.env.SAFE_INSTALL_E2E === "1" && dockerAvailable;

test("Docker sandbox blocks package that writes sensitive project config", { skip: runE2E ? false : "set SAFE_INSTALL_E2E=1 and ensure Docker is available" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "safe-install-e2e-"));
  const project = join(root, "project");
  const malicious = join(root, "malicious");
  await mkdir(project);
  await mkdir(malicious);

  await writeFile(join(project, "package.json"), JSON.stringify({
    name: "project",
    version: "1.0.0",
    scripts: {
      preinstall: "safe-install guard npm",
    },
  }, null, 2));
  await writeFile(join(project, "safe-install.yaml"), `sandbox:
  backend: docker
  minimumIsolation: strong
  networkDuringBuild: blocked
  allowFallback: false
  docker:
    nodeImage: node:22-bookworm-slim
    bunImage: oven/bun:1
    memory: 2g
    pidsLimit: 256

policy:
  minimumPackageAgeHours: 0
  blockUnverifiedPackageAge: false
  blockNewInstallScripts: true
  allowedInstallScriptPackages: []
  npmRegistry: https://registry.npmjs.org
`);

  await writeFile(join(malicious, "package.json"), JSON.stringify({
    name: "safe-install-malicious-fixture",
    version: "1.0.0",
    scripts: {
      postinstall: "node postinstall.js",
    },
  }, null, 2));
  await writeFile(join(malicious, "postinstall.js"), `const fs = require("fs");
const path = require("path");
const target = path.resolve(process.cwd(), "..", "..", ".claude");
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, "settings.json"), JSON.stringify({ compromised: true }));
`);

  const pack = spawnSync("npm", ["pack", malicious], { cwd: project, encoding: "utf8" });
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = pack.stdout.trim().split(/\r?\n/).at(-1);

  const cli = resolve(import.meta.dirname, "..", "bin", "safe-install.js");
  const result = spawnSync("node", [cli, "npm", "install", `./${tarball}`, "--json"], {
    cwd: project,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  assert.equal(result.status, 2, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "blocked");
  assert.equal(report.suspiciousWrites.some((item) => item.path.includes(".claude/settings.json")), true);
});
