import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export async function analyzeDependencyFiles({ cwd, readBaseFile }) {
  const packageJson = await analyzePackageJson(cwd, readBaseFile);
  const lockfiles = [];

  for (const file of LOCKFILES) {
    const currentPath = join(cwd, file);
    const current = existsSync(currentPath) ? await readFile(currentPath, "utf8").catch(() => null) : null;
    const base = await readBaseFile(file);
    if (current === null && base === null) continue;
    lockfiles.push(analyzeLockfile(file, base, current));
  }

  return {
    packageJson,
    lockfiles,
    changedFiles: [
      ...(packageJson.changed ? ["package.json"] : []),
      ...lockfiles.filter((item) => item.changed).map((item) => item.file),
    ],
    packageChanges: lockfiles.flatMap((item) => item.packageChanges),
    installScriptFindings: lockfiles.flatMap((item) => item.installScriptFindings),
    unsupportedLockfiles: lockfiles.filter((item) => item.unsupported).map((item) => item.file),
  };
}

export function analyzeLockfile(file, baseText, currentText) {
  const changed = baseText !== currentText;
  const empty = {
    file,
    changed,
    parser: null,
    unsupported: false,
    packageChanges: [],
    installScriptFindings: [],
    warnings: [],
  };

  if (!changed || currentText === null) return empty;
  if (file === "bun.lockb") {
    return { ...empty, unsupported: true, warnings: ["bun.lockb is binary; detailed diff is not implemented yet."] };
  }

  const parser = parserFor(file);
  if (!parser) return { ...empty, unsupported: true, warnings: [`No parser for ${file}.`] };

  try {
    const before = baseText ? parser(baseText) : new Map();
    const after = currentText ? parser(currentText) : new Map();
    const packageChanges = diffPackageMaps(before, after).map((change) => ({ ...change, lockfile: file }));
    const installScriptFindings = packageChanges
      .filter((change) => ["added", "changed"].includes(change.status))
      .filter((change) => change.current?.hasInstallScript)
      .map((change) => ({
        lockfile: file,
        status: change.status,
        name: change.current.name,
        version: change.current.version,
        path: change.current.path,
        reason: `${change.current.name}@${change.current.version} introduces install/build scripts.`,
      }));

    return {
      ...empty,
      parser: parser.name,
      packageChanges,
      installScriptFindings,
    };
  } catch (error) {
    return {
      ...empty,
      unsupported: true,
      warnings: [`Could not parse ${file}: ${error.message}`],
    };
  }
}

export function parsePackageLock(text) {
  const lock = JSON.parse(text);
  const packages = new Map();

  if (lock.packages && typeof lock.packages === "object") {
    for (const [path, meta] of Object.entries(lock.packages)) {
      if (!path || !path.includes("node_modules/") || !meta?.version) continue;
      const name = packageNameFromNodeModulesPath(path);
      packages.set(path, {
        path,
        name,
        version: String(meta.version),
        resolved: meta.resolved || null,
        integrity: meta.integrity || null,
        hasInstallScript: Boolean(meta.hasInstallScript),
      });
    }
    return packages;
  }

  walkNpmLockV1(lock.dependencies || {}, "node_modules", packages);
  return packages;
}

export function parsePnpmLock(text) {
  const packages = new Map();
  const lines = text.split(/\r?\n/);
  let inPackages = false;
  let current = null;

  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line) && !/^packages:\s*$/.test(line)) {
      inPackages = false;
      current = null;
    }
    if (!inPackages) continue;

    const keyMatch = /^ {2}([/?@][^:]+|[^:\s][^:]+):\s*$/.exec(line);
    if (keyMatch) {
      const parsed = parsePnpmPackageKey(keyMatch[1].replace(/^['"]|['"]$/g, ""));
      current = parsed
        ? { path: keyMatch[1], name: parsed.name, version: parsed.version, resolved: null, integrity: null, hasInstallScript: false }
        : null;
      if (current) packages.set(current.path, current);
      continue;
    }

    if (!current) continue;
    if (/^\s+requiresBuild:\s+true\s*$/.test(line)) current.hasInstallScript = true;
    const integrityMatch = /^\s+integrity:\s+(.+)\s*$/.exec(line);
    if (integrityMatch) current.integrity = integrityMatch[1].trim();
  }

  return packages;
}

export function parseYarnLock(text) {
  const packages = new Map();
  let currentSpecs = [];
  let currentVersion = null;
  let currentHasScript = false;

  function flush() {
    if (!currentVersion) return;
    for (const spec of currentSpecs) {
      const name = yarnNameFromSpec(spec);
      if (!name) continue;
      const path = `${name}@${currentVersion}`;
      packages.set(path, {
        path,
        name,
        version: currentVersion,
        resolved: null,
        integrity: null,
        hasInstallScript: currentHasScript,
      });
    }
  }

  for (const line of text.split(/\r?\n/)) {
    if (line && !line.startsWith(" ") && line.endsWith(":")) {
      flush();
      currentSpecs = line.slice(0, -1).split(/,\s*/).map((item) => item.replace(/^"|"$/g, ""));
      currentVersion = null;
      currentHasScript = false;
      continue;
    }
    const versionMatch = /^ {2}version "?([^"\s]+)"?\s*$/.exec(line);
    if (versionMatch) currentVersion = versionMatch[1];
  }
  flush();

  return packages;
}

export async function analyzePackageJson(cwd, readBaseFile) {
  const currentPath = join(cwd, "package.json");
  const currentText = existsSync(currentPath) ? await readFile(currentPath, "utf8") : null;
  const baseText = await readBaseFile("package.json");
  const changed = currentText !== baseText;

  if (!changed || !currentText) {
    return { changed, directDependencyChanges: [], warnings: [] };
  }

  const before = baseText ? JSON.parse(baseText) : {};
  const after = JSON.parse(currentText);
  return {
    changed,
    directDependencyChanges: diffDirectDependencies(before, after),
    warnings: [],
  };
}

export function diffDirectDependencies(before, after) {
  const changes = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const beforeDeps = before[section] || {};
    const afterDeps = after[section] || {};
    const names = new Set([...Object.keys(beforeDeps), ...Object.keys(afterDeps)]);
    for (const name of [...names].sort()) {
      if (beforeDeps[name] === afterDeps[name]) continue;
      changes.push({
        section,
        name,
        before: beforeDeps[name] || null,
        after: afterDeps[name] || null,
        status: beforeDeps[name] ? afterDeps[name] ? "changed" : "removed" : "added",
      });
    }
  }
  return changes;
}

export function diffPackageMaps(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changes = [];
  for (const key of [...keys].sort()) {
    const oldEntry = before.get(key) || null;
    const newEntry = after.get(key) || null;
    if (JSON.stringify(oldEntry) === JSON.stringify(newEntry)) continue;
    changes.push({
      status: oldEntry ? newEntry ? "changed" : "removed" : "added",
      previous: oldEntry,
      current: newEntry,
    });
  }
  return changes;
}

export function isPublicNpmResolved(resolved) {
  return !resolved || resolved.startsWith("https://registry.npmjs.org/");
}

function parserFor(file) {
  if (file === "package-lock.json") return parsePackageLock;
  if (file === "pnpm-lock.yaml") return parsePnpmLock;
  if (file === "yarn.lock") return parseYarnLock;
  return null;
}

function walkNpmLockV1(deps, prefix, packages) {
  for (const [name, meta] of Object.entries(deps)) {
    const path = `${prefix}/${name}`;
    packages.set(path, {
      path,
      name,
      version: String(meta.version || ""),
      resolved: meta.resolved || null,
      integrity: meta.integrity || null,
      hasInstallScript: false,
    });
    if (meta.dependencies) walkNpmLockV1(meta.dependencies, `${path}/node_modules`, packages);
  }
}

function packageNameFromNodeModulesPath(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  const rest = path.slice(index + marker.length);
  if (rest.startsWith("@")) {
    const [scope, name] = rest.split("/");
    return `${scope}/${name}`;
  }
  return rest.split("/")[0];
}

function parsePnpmPackageKey(key) {
  let clean = key.replace(/^\//, "");
  const paren = clean.indexOf("(");
  if (paren !== -1) clean = clean.slice(0, paren);
  const at = clean.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: clean.slice(0, at), version: clean.slice(at + 1) };
}

function yarnNameFromSpec(spec) {
  const clean = spec.replace(/^npm:/, "");
  if (clean.startsWith("@")) {
    const secondAt = clean.indexOf("@", clean.indexOf("/") + 1);
    return secondAt === -1 ? clean : clean.slice(0, secondAt);
  }
  const at = clean.indexOf("@");
  return at <= 0 ? clean : clean.slice(0, at);
}
