#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const check = process.argv.includes("--check");
const log = spawnSync("git", ["log", "--pretty=format:%H%x09%s"], {
  encoding: "utf8",
});

if (log.status !== 0 && !/does not have any commits yet/.test(log.stderr || "")) {
  console.error(log.stderr || "Unable to read git log");
  process.exit(log.status || 1);
}

const entries = log.stdout
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [hash, subject] = line.split("\t");
    return { hash: hash.slice(0, 8), subject };
  })
  .filter((entry) => !/^chore\(release\): v/.test(entry.subject));

const grouped = {
  Features: [],
  Fixes: [],
  Documentation: [],
  Other: [],
};

for (const entry of entries) {
  if (/^feat(\(.+\))?:/.test(entry.subject)) grouped.Features.push(entry);
  else if (/^fix(\(.+\))?:/.test(entry.subject)) grouped.Fixes.push(entry);
  else if (/^docs?(\(.+\))?:/.test(entry.subject)) grouped.Documentation.push(entry);
  else grouped.Other.push(entry);
}

let output = "# Changelog\n\n";
output += "This file is generated from conventional-style git commit subjects by `npm run changelog`.\n\n";

for (const [section, items] of Object.entries(grouped)) {
  if (items.length === 0) continue;
  output += `## ${section}\n\n`;
  for (const item of items) {
    output += `- ${item.subject} (${item.hash})\n`;
  }
  output += "\n";
}

if (entries.length === 0) {
  output += "No commits yet.\n";
}

const current = existsSync("CHANGELOG.md") ? readFileSync("CHANGELOG.md", "utf8") : "";

if (check) {
  if (current !== output) {
    console.error("CHANGELOG.md is out of date. Run npm run changelog.");
    process.exit(1);
  }
} else {
  writeFileSync("CHANGELOG.md", output);
}
