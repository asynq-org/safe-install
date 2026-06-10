import { spawnSync } from "node:child_process";

export function resolveBaseRef(env = process.env, explicitBase = null) {
  if (explicitBase) return explicitBase;
  if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`;
  return "HEAD";
}

export function readGitFile(cwd, ref, file) {
  const result = spawnSync("git", ["show", `${ref}:${file}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return result.stdout;
}
