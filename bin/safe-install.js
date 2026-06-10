#!/usr/bin/env node

import { runCli } from "../src/cli.js";

runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
}).catch((error) => {
  console.error(`safe-install: ${error.message}`);
  if (process.env.SAFE_INSTALL_DEBUG) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
