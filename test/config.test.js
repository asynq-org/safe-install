import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, renderDefaultConfig } from "../src/config.js";

test("loads default config when no policy exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "safe-install-test-"));
  const config = await loadConfig(dir);

  assert.equal(config.sandbox.backend, "docker");
  assert.equal(config.sandbox.minimumIsolation, "strong");
  assert.equal(config.packageManagers.javascript.npm, true);
});

test("parses generated yaml policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "safe-install-test-"));
  await writeFile(join(dir, "safe-install.yaml"), renderDefaultConfig());

  const config = await loadConfig(dir);

  assert.equal(config.sandbox.docker.nodeImage, "node:22-bookworm-slim");
  assert.equal(config.sandbox.docker.pidsLimit, 256);
  assert.equal(config.agents.shellShims, true);
});
