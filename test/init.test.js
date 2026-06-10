import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initProject } from "../src/init.js";

test("init can add package.json preinstall guard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "safe-install-init-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));

  await initProject(dir, ["--package-json-guard"], {});

  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  assert.equal(pkg.scripts.preinstall, "safe-install guard npm");
  assert.equal(pkg.scripts.test, "node --test");
});

test("init composes package.json preinstall guard with existing preinstall", async () => {
  const dir = await mkdtemp(join(tmpdir(), "safe-install-init-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { preinstall: "node check.js" } }, null, 2));

  await initProject(dir, ["--package-json-guard"], {});

  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  assert.equal(pkg.scripts.preinstall, "safe-install guard npm && node check.js");
});

test("init appends agent instructions without replacing existing content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "safe-install-init-"));
  await writeFile(join(dir, "AGENTS.md"), "# Existing Agent Policy\n\nKeep this section.\n");

  await initProject(dir, ["--agents"], {});
  await initProject(dir, ["--agents"], {});

  const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /# Existing Agent Policy/);
  assert.match(agents, /Keep this section/);
  assert.match(agents, /safe-install:start/);
  assert.match(agents, /Never run npm, pnpm, yarn, or bun directly/);
  assert.equal(agents.match(/safe-install:start/g).length, 1);
});
