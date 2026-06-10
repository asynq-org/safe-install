import { analyzeDependencyFiles } from "./lockfile-diff.js";
import { checkConcretePackageAges } from "./package-age.js";
import { loadConfig } from "./config.js";
import { detectCapabilities } from "./detect.js";
import { readGitFile, resolveBaseRef } from "./git-utils.js";
import { formatVerificationReport } from "./verification-report.js";

export async function runVerifyLockfile(args, context, { ci = false } = {}) {
  const options = parseVerifyOptions(args);
  const config = await loadConfig(context.cwd);
  const baseRef = resolveBaseRef(context.env, options.baseRef);
  const capabilities = detectCapabilities(context.env);
  const diff = await analyzeDependencyFiles({
    cwd: context.cwd,
    readBaseFile: async (file) => readGitFile(context.cwd, baseRef, file),
  });

  const packagesForAge = diff.packageChanges
    .filter((change) => ["added", "changed"].includes(change.status))
    .map((change) => ({ ...change.current, lockfile: change.lockfile }))
    .filter(Boolean)

  const packageAge = await checkConcretePackageAges({
    packages: packagesForAge,
    config,
  });

  const violations = [
    ...packageAge.violations.map((violation) => ({ type: "package-age", reason: violation.reason })),
  ];

  const blockedScripts = installScriptViolations(diff, config);
  violations.push(...blockedScripts);

  if (ci && !capabilities.docker.available) {
    violations.push({ type: "sandbox", reason: "Docker is required for safe-install ci but is unavailable." });
  }

  const report = {
    status: violations.length > 0 ? "blocked" : "passed",
    baseRef,
    ci,
    capabilities,
    diff,
    packageAge,
    violations,
    notes: [
      "Private/custom registry packages are allowed for package-age policy in this prototype.",
      "Transitive package age checks are based on parsed lockfile changes.",
    ],
  };

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatVerificationReport(report));

  if (report.status !== "passed") process.exitCode = 2;
  return report;
}

function parseVerifyOptions(args) {
  let json = false;
  let baseRef = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--base") {
      baseRef = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--base=")) {
      baseRef = arg.slice("--base=".length);
    } else {
      throw new Error(`unknown verify-lockfile option "${arg}"`);
    }
  }

  return { json, baseRef };
}

function installScriptViolations(diff, config) {
  if (config.policy?.blockNewInstallScripts === false) return [];
  const allowed = new Set(config.policy?.allowedInstallScriptPackages || []);
  return diff.installScriptFindings
    .filter((finding) => !allowed.has(finding.name))
    .map((finding) => ({ type: "install-script", reason: finding.reason }));
}
