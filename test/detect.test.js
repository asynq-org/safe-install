import test from "node:test";
import assert from "node:assert/strict";
import { formatCapabilities } from "../src/detect.js";

test("doctor output explains Docker Desktop installed but missing PATH", () => {
  const text = formatCapabilities({
    platform: "darwin",
    arch: "arm64",
    docker: {
      available: false,
      installedButNotOnPath: true,
      installHint: [
        "Docker Desktop is installed, but docker is not on PATH.",
        "Run:",
        '  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"',
      ].join("\n"),
    },
    podman: { available: false },
    bubblewrap: { available: false },
    firejail: { available: false },
    lima: { available: false },
  });

  assert.match(text, /Docker Desktop is installed/);
  assert.match(text, /export PATH="\/Applications\/Docker\.app\/Contents\/Resources\/bin:\$PATH"/);
});
