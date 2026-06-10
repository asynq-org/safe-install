import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeLockfile,
  diffDirectDependencies,
  parsePackageLock,
  parsePnpmLock,
} from "../src/lockfile-diff.js";

test("parsePackageLock extracts package entries and install script flag", () => {
  const entries = parsePackageLock(JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture" },
      "node_modules/zod": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/zod/-/zod-1.0.0.tgz",
        integrity: "sha512-old",
      },
      "node_modules/native": {
        version: "2.0.0",
        hasInstallScript: true,
      },
    },
  }));

  assert.equal(entries.get("node_modules/zod").name, "zod");
  assert.equal(entries.get("node_modules/native").hasInstallScript, true);
});

test("analyzeLockfile reports added packages and install scripts", () => {
  const before = JSON.stringify({ lockfileVersion: 3, packages: {} });
  const after = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "node_modules/native": {
        version: "2.0.0",
        hasInstallScript: true,
      },
    },
  });

  const report = analyzeLockfile("package-lock.json", before, after);
  assert.equal(report.changed, true);
  assert.equal(report.packageChanges.length, 1);
  assert.equal(report.installScriptFindings.length, 1);
});

test("parsePnpmLock extracts package keys and requiresBuild", () => {
  const entries = parsePnpmLock(`lockfileVersion: '9.0'

packages:
  zod@1.0.0:
    resolution:
      integrity: sha512-old
  '@scope/pkg@2.0.0':
    requiresBuild: true
`);

  assert.equal(entries.get("zod@1.0.0").name, "zod");
  assert.equal(entries.get("'@scope/pkg@2.0.0'").hasInstallScript, true);
});

test("diffDirectDependencies reports section-level dependency changes", () => {
  const changes = diffDirectDependencies(
    { dependencies: { zod: "^1.0.0" } },
    { dependencies: { zod: "^2.0.0" }, devDependencies: { vitest: "^1.0.0" } },
  );

  assert.deepEqual(changes.map((item) => `${item.status}:${item.section}.${item.name}`), [
    "changed:dependencies.zod",
    "added:devDependencies.vitest",
  ]);
});
