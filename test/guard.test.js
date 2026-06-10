import test from "node:test";
import assert from "node:assert/strict";
import { runGuard } from "../src/guard.js";

test("guard blocks raw package manager installs", () => {
  const previousExitCode = process.exitCode;
  const messages = [];
  const originalError = console.error;
  console.error = (message) => messages.push(message);
  process.exitCode = undefined;

  try {
    runGuard(["npm"], { env: {} });
    assert.equal(process.exitCode, 99);
    assert.match(messages.join("\n"), /blocked raw npm install/);
    assert.match(messages.join("\n"), /safe-install npm install <pkg> --apply/);
  } finally {
    console.error = originalError;
    process.exitCode = previousExitCode;
  }
});

test("guard allows internal safe-install apply", () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    runGuard(["npm"], { env: { SAFE_INSTALL_INTERNAL_APPLY: "1" } });
    assert.equal(process.exitCode, undefined);
  } finally {
    process.exitCode = previousExitCode;
  }
});
