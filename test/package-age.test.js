import test from "node:test";
import assert from "node:assert/strict";
import {
  checkMinimumPackageAge,
  extractDirectPackageSpecs,
  parsePackageSpec,
} from "../src/package-age.js";

test("extracts direct package specs from dependency commands", () => {
  assert.deepEqual(extractDirectPackageSpecs("npm", ["install", "zod", "--save-dev"]), ["zod"]);
  assert.deepEqual(extractDirectPackageSpecs("pnpm", ["add", "@scope/pkg@1.2.3", "--filter", "web"]), ["@scope/pkg@1.2.3"]);
  assert.deepEqual(extractDirectPackageSpecs("npm", ["run", "build"]), []);
});

test("parses scoped and unscoped package specs", () => {
  assert.deepEqual(parsePackageSpec("zod@1.0.0"), { name: "zod", requested: "1.0.0" });
  assert.deepEqual(parsePackageSpec("@scope/pkg@2.0.0"), { name: "@scope/pkg", requested: "2.0.0" });
  assert.deepEqual(parsePackageSpec("@scope/pkg"), { name: "@scope/pkg", requested: null });
});

test("minimum package age blocks fresh direct dependency versions", async () => {
  const result = await checkMinimumPackageAge({
    packageManager: "npm",
    args: ["install", "fresh@1.0.0"],
    now: new Date("2026-06-10T12:00:00Z"),
    config: {
      policy: {
        minimumPackageAgeHours: 48,
        blockUnverifiedPackageAge: false,
        npmRegistry: "https://registry.npmjs.org",
      },
    },
    fetchPackument: async () => ({
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": {} },
      time: { "1.0.0": "2026-06-10T00:00:00Z" },
    }),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0].reason, /minimum age is 48h/);
});

test("minimum package age allows old direct dependency versions and custom one-week policy", async () => {
  const result = await checkMinimumPackageAge({
    packageManager: "npm",
    args: ["install", "stable"],
    now: new Date("2026-06-10T12:00:00Z"),
    config: {
      policy: {
        minimumPackageAgeHours: 168,
        blockUnverifiedPackageAge: false,
        npmRegistry: "https://registry.npmjs.org",
      },
    },
    fetchPackument: async () => ({
      "dist-tags": { latest: "3.0.0" },
      versions: { "3.0.0": {} },
      time: { "3.0.0": "2026-05-20T00:00:00Z" },
    }),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.checks[0].minimumHours, 168);
  assert.equal(result.violations.length, 0);
});

test("minimum package age can warn instead of blocking unverified packages", async () => {
  const result = await checkMinimumPackageAge({
    packageManager: "npm",
    args: ["install", "private-package"],
    config: {
      policy: {
        minimumPackageAgeHours: 48,
        blockUnverifiedPackageAge: false,
      },
    },
    fetchPackument: async () => {
      throw new Error("not found");
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.warnings.length, 1);
});
