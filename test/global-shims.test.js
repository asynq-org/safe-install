import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installGlobalShims, uninstallGlobalShims } from "../src/global-shims.js";

test("install global shims dry run does not write files", async () => {
  const home = await mkdtemp(join(tmpdir(), "safe-install-home-"));
  const result = await installGlobalShims([], { env: { HOME: home } });

  assert.equal(result.apply, false);
  assert.match(result.message, /Dry run/);
  await assert.rejects(() => stat(join(home, ".safe-install", "shims", "npm")));
});

test("install global shims apply writes package manager shims", async () => {
  const home = await mkdtemp(join(tmpdir(), "safe-install-home-"));
  await installGlobalShims(["--apply"], { env: { HOME: home } });

  const npmShim = await readFile(join(home, ".safe-install", "shims", "npm"), "utf8");
  assert.match(npmShim, /safe-install "\$pm" "\$@" --apply/);
  assert.match(npmShim, /find_safe_install_root/);
});

test("uninstall global shims apply removes package manager shims", async () => {
  const home = await mkdtemp(join(tmpdir(), "safe-install-home-"));
  await installGlobalShims(["--apply"], { env: { HOME: home } });
  await uninstallGlobalShims(["--apply"], { env: { HOME: home } });

  await assert.rejects(() => stat(join(home, ".safe-install", "shims", "npm")));
});
