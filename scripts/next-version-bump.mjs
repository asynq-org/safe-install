#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

const lastTag = git(["describe", "--tags", "--match", "v*", "--abbrev=0"]);
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const log = git(["log", "--pretty=format:%s%n%b%x1e", range]);
const commits = log.split("\x1e").map((entry) => entry.trim()).filter(Boolean);

let bump = "patch";

for (const commit of commits) {
  const firstLine = commit.split(/\r?\n/)[0] || "";
  if (/BREAKING CHANGE:/.test(commit) || /^[a-z]+(?:\([^)]+\))?!:/.test(firstLine)) {
    bump = "major";
    break;
  }
  if (/^feat(?:\([^)]+\))?:/.test(firstLine)) {
    bump = "minor";
  }
}

process.stdout.write(bump);
