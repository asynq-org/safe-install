import { get } from "node:https";
import { isPublicNpmResolved } from "./lockfile-diff.js";

const DEPENDENCY_COMMANDS = new Set([
  "add",
  "i",
  "install",
  "up",
  "update",
]);

export async function checkMinimumPackageAge({ packageManager, args, config, now = new Date(), fetchPackument = fetchNpmPackument }) {
  const minimumHours = Number(config.policy?.minimumPackageAgeHours || 0);
  if (minimumHours <= 0) {
    return { status: "skipped", checks: [], violations: [], warnings: [] };
  }

  const specs = extractDirectPackageSpecs(packageManager, args);
  if (specs.length === 0) {
    return {
      status: "skipped",
      checks: [],
      violations: [],
      warnings: ["No direct package specs found; package age checks only run for explicit package specs in this command."],
    };
  }

  const checks = [];
  const violations = [];
  const warnings = [];

  for (const spec of specs) {
    const parsed = parsePackageSpec(spec);
    if (!parsed) continue;

    try {
      const packument = await fetchPackument(parsed.name, config.policy?.npmRegistry);
      const version = resolveVersion(parsed, packument);
      if (!version) {
        const message = `Could not resolve ${spec} to a concrete npm version.`;
        if (config.policy?.blockUnverifiedPackageAge) violations.push({ spec, reason: message });
        else warnings.push(message);
        continue;
      }

      const publishedAt = packument.time?.[version];
      if (!publishedAt) {
        const message = `Could not verify publish time for ${parsed.name}@${version}.`;
        if (config.policy?.blockUnverifiedPackageAge) violations.push({ spec, name: parsed.name, version, reason: message });
        else warnings.push(message);
        continue;
      }

      const ageHours = (now.getTime() - new Date(publishedAt).getTime()) / 36e5;
      const check = {
        spec,
        name: parsed.name,
        version,
        publishedAt,
        ageHours: Math.max(0, Math.floor(ageHours * 10) / 10),
        minimumHours,
      };
      checks.push(check);

      if (ageHours < minimumHours) {
        violations.push({
          ...check,
          reason: `${parsed.name}@${version} was published ${check.ageHours}h ago; minimum age is ${minimumHours}h.`,
        });
      }
    } catch (error) {
      const message = `Could not verify package age for ${spec}: ${error.message}`;
      if (config.policy?.blockUnverifiedPackageAge) violations.push({ spec, reason: message });
      else warnings.push(message);
    }
  }

  return {
    status: violations.length > 0 ? "blocked" : "passed",
    checks,
    violations,
    warnings,
  };
}

export async function checkConcretePackageAges({ packages, config, now = new Date(), fetchPackument = fetchNpmPackument }) {
  const minimumHours = Number(config.policy?.minimumPackageAgeHours || 0);
  if (minimumHours <= 0) {
    return { status: "skipped", checks: [], violations: [], warnings: [], skipped: [] };
  }

  const checks = [];
  const violations = [];
  const warnings = [];
  const skipped = [];
  const seen = new Set();

  for (const pkg of packages) {
    if (!pkg?.name || !pkg?.version) continue;
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!isPublicNpmResolved(pkg.resolved)) {
      skipped.push({ ...pkg, reason: "private or custom registry package automatically allowed" });
      continue;
    }

    try {
      const packument = await fetchPackument(pkg.name, config.policy?.npmRegistry);
      const publishedAt = packument.time?.[pkg.version];
      if (!publishedAt) {
        const message = `Could not verify publish time for ${pkg.name}@${pkg.version}.`;
        if (config.policy?.blockUnverifiedPackageAge) violations.push({ ...pkg, reason: message });
        else warnings.push(message);
        continue;
      }

      const ageHours = (now.getTime() - new Date(publishedAt).getTime()) / 36e5;
      const check = {
        name: pkg.name,
        version: pkg.version,
        path: pkg.path,
        lockfile: pkg.lockfile,
        publishedAt,
        ageHours: Math.max(0, Math.floor(ageHours * 10) / 10),
        minimumHours,
      };
      checks.push(check);

      if (ageHours < minimumHours) {
        violations.push({
          ...check,
          reason: `${pkg.name}@${pkg.version} was published ${check.ageHours}h ago; minimum age is ${minimumHours}h.`,
        });
      }
    } catch (error) {
      const message = `Could not verify package age for ${pkg.name}@${pkg.version}: ${error.message}`;
      if (config.policy?.blockUnverifiedPackageAge) violations.push({ ...pkg, reason: message });
      else warnings.push(message);
    }
  }

  return {
    status: violations.length > 0 ? "blocked" : "passed",
    checks,
    violations,
    warnings,
    skipped,
  };
}

export function extractDirectPackageSpecs(packageManager, args) {
  const command = args[0];
  if (!DEPENDENCY_COMMANDS.has(command)) return [];

  const specs = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === "--") continue;
    if (arg.startsWith("-")) {
      if (flagTakesValue(arg) && index + 1 < args.length) index += 1;
      continue;
    }
    if (arg.includes("/") && (arg.startsWith(".") || arg.startsWith("/") || arg.startsWith("file:"))) continue;
    if (/^(git\+|https?:|ssh:)/.test(arg)) continue;
    specs.push(arg);
  }

  if (packageManager === "npm" && command === "install" && specs.length === 0) return [];
  return specs;
}

export function parsePackageSpec(spec) {
  if (!spec || spec.startsWith("@") && !spec.includes("/")) return null;
  if (spec.startsWith("@")) {
    const at = spec.indexOf("@", spec.indexOf("/") + 1);
    return at === -1
      ? { name: spec, requested: null }
      : { name: spec.slice(0, at), requested: spec.slice(at + 1) };
  }

  const at = spec.lastIndexOf("@");
  return at > 0
    ? { name: spec.slice(0, at), requested: spec.slice(at + 1) }
    : { name: spec, requested: null };
}

function resolveVersion(parsed, packument) {
  if (parsed.requested && packument.versions?.[parsed.requested]) return parsed.requested;
  if (parsed.requested && packument["dist-tags"]?.[parsed.requested]) return packument["dist-tags"][parsed.requested];
  if (!parsed.requested) return packument["dist-tags"]?.latest;
  return null;
}

function flagTakesValue(arg) {
  return [
    "--tag",
    "--workspace",
    "--filter",
    "--registry",
    "--cache",
    "--prefix",
  ].includes(arg);
}

export function fetchNpmPackument(name, registry = "https://registry.npmjs.org") {
  const base = registry.replace(/\/$/, "");
  const encoded = name.startsWith("@")
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name);
  const url = `${base}/${encoded}`;

  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { accept: "application/vnd.npm.install-v1+json, application/json" } }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`registry returned ${response.statusCode}`));
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`invalid registry JSON: ${error.message}`));
        }
      });
    });

    request.setTimeout(15_000, () => {
      request.destroy(new Error("registry request timed out"));
    });
    request.on("error", reject);
  });
}
