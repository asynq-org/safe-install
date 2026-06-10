import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runVerifyLockfile } from "../src/verify-lockfile.js";

test("verify-lockfile reports lockfile package changes without network when age gate disabled", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "safe-install-verify-"));
  spawnSync("git", ["init"], { cwd, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Test"], { cwd, stdio: "ignore" });

  await writeFile(join(cwd, "safe-install.yaml"), `sandbox:
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
  blockNewInstallScripts: false
  allowedInstallScriptPackages: []
  npmRegistry: https://registry.npmjs.org
`);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2));
  await writeFile(join(cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }, null, 2));
  spawnSync("git", ["add", "."], { cwd, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "base"], { cwd, stdio: "ignore" });

  await writeFile(join(cwd, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "node_modules/zod": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/zod/-/zod-1.0.0.tgz",
      },
    },
  }, null, 2));

  let output = "";
  const originalLog = console.log;
  const previousExitCode = process.exitCode;
  console.log = (value) => {
    output += `${value}\n`;
  };
  process.exitCode = undefined;

  try {
    const report = await runVerifyLockfile(["--json"], { cwd, env: {} });
    assert.equal(report.status, "passed");
    assert.equal(report.diff.packageChanges.length, 1);
    assert.match(output, /"packageChanges"/);
  } finally {
    console.log = originalLog;
    process.exitCode = previousExitCode;
  }

  const pkg = JSON.parse(await readFile(join(cwd, "package-lock.json"), "utf8"));
  assert.equal(pkg.packages["node_modules/zod"].version, "1.0.0");
});
