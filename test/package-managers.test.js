import test from "node:test";
import assert from "node:assert/strict";
import { appendMissing, PACKAGE_MANAGER_DEFS } from "../src/package-managers.js";

test("appendMissing preserves existing flags", () => {
  assert.deepEqual(appendMissing(["install", "--ignore-scripts"], "--ignore-scripts"), [
    "install",
    "--ignore-scripts",
  ]);
});

test("appendMissing appends absent flags", () => {
  assert.deepEqual(appendMissing(["install", "zod"], "--ignore-scripts"), [
    "install",
    "zod",
    "--ignore-scripts",
  ]);
});

test("all supported package managers disable scripts for real apply", () => {
  for (const [name, def] of Object.entries(PACKAGE_MANAGER_DEFS)) {
    const args = def.realApplyArgs(["install", "zod"]);
    assert.equal(args.includes("--ignore-scripts"), true, `${name} should disable scripts`);
  }
});
