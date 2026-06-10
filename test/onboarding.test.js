import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { runOnboarding } from "../src/onboarding.js";

test("onboarding dry run with defaults does not write project files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "safe-install-onboarding-"));

  const result = await runOnboarding(["--dry-run", "--defaults"], {
    cwd: dir,
    env: { HOME: join(dir, "home") },
  });

  assert.equal(result.dryRun, true);
  assert.match(result.summary, /Dry run: onboarding plan/);
  await assert.rejects(() => stat(join(dir, "safe-install.yaml")));
});

test("onboarding with defaults writes config, agent files, repo shims, and package guard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "safe-install-onboarding-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));

  const result = await runOnboarding(["--defaults"], {
    cwd: dir,
    env: { HOME: join(dir, "home") },
  });

  assert.equal(result.dryRun, false);
  assert.match(result.summary, /Onboarding complete/);

  const config = await loadConfig(dir);
  assert.equal(config.policy.minimumPackageAgeHours, 48);
  assert.equal(config.agents.instructionFiles, true);
  assert.equal(config.agents.shellShims, true);

  const npmShim = await readFile(join(dir, ".safe-install", "bin", "npm"), "utf8");
  assert.match(npmShim, /safe-install npm/);

  const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /Never run npm, pnpm, yarn, or bun directly/);

  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  assert.equal(pkg.scripts.preinstall, "safe-install guard npm");

  await assert.rejects(() => stat(join(dir, "home", ".safe-install", "shims", "npm")));
});

test("onboarding does not replace an existing policy file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "safe-install-onboarding-"));
  await writeFile(join(dir, "safe-install.yaml"), "policy:\n  minimumPackageAgeHours: 168\n");

  await runOnboarding(["--defaults"], {
    cwd: dir,
    env: { HOME: join(dir, "home") },
  });

  const policy = await readFile(join(dir, "safe-install.yaml"), "utf8");
  assert.equal(policy, "policy:\n  minimumPackageAgeHours: 168\n");
});
