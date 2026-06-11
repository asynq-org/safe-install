import test from "node:test";
import assert from "node:assert/strict";
import { formatReport } from "../src/report.js";

test("formats report with sandbox guarantees", () => {
  const text = formatReport({
    command: ["npm", "install", "zod"],
    status: "passed",
    sandbox: {
      backend: "docker",
      isolation: "strong",
      networkDuringBuild: "blocked",
      realSecretsMounted: false,
      realProjectMounted: false,
    },
    phases: [
      { name: "resolve-and-fetch", status: 0 },
      { name: "offline-script-detonation", status: 99, stderr: "first line\nsecond line" },
    ],
    changedFiles: [{ path: "package-lock.json", status: "modified" }],
    suspiciousWrites: [],
    notes: ["Apply mode updates the real project with install scripts disabled."],
  });

  assert.match(text, /Isolation: strong/);
  assert.match(text, /Real secrets mounted: no/);
  assert.match(text, /modified: package-lock\.json/);
  assert.match(text, /^\+-+\+/);
  assert.match(text, /\+-+\+$/);
  assert.match(text, /\| first line\s+\|/);
  assert.match(text, /\| second line\s+\|/);
});
