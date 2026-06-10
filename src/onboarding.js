import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE, DEFAULT_CONFIG, renderConfig } from "./config.js";
import { detectCapabilities, formatCapabilities } from "./detect.js";
import { installGlobalShims } from "./global-shims.js";
import { writeAgentInstructions, writePackageJsonGuard, writeShims } from "./init.js";

const ONBOARDING_LOGO = String.raw`

   _____ ___  ______ ______      ____ _   __ _____ ______ ___    __    __
  / ___//   |/ ____// ____/____ /  _// | / // ___//_  __//   |  / /   / /
  \__ \/ /| / /_   / __/ /____/ / / /  |/ / \__ \  / /  / /| | / /   / /
 ___/ / ___/ __/  / /___      _/ / / /|  / ___/ / / /  / ___ |/ /___/ /___
/____/_/  /_/    /_____/     /___//_/ |_/ /____/ /_/  /_/  |_/_____/_____/
`.replace(/^\n/, "").replace(/\n$/, "");

export async function runOnboarding(args, context) {
  const options = parseOnboardingOptions(args);
  const interactive = !options.defaults;
  const answers = options.defaults
    ? defaultAnswers()
    : await promptForAnswers({
        input: context.stdin || process.stdin,
        output: context.stdout || process.stdout,
      });

  const plan = buildOnboardingPlan(answers, context.env);

  if (!options.dryRun) {
    await applyOnboardingPlan(context.cwd, plan, context);
  }

  return {
    dryRun: options.dryRun,
    answers,
    plan,
    summary: formatOnboardingSummary(plan, {
      dryRun: options.dryRun,
      env: context.env,
      showLogo: !interactive,
    }),
  };
}

export function buildOnboardingPlan(answers, env = process.env) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.policy.minimumPackageAgeHours = answers.minimumPackageAgeHours;
  config.policy.blockUnverifiedPackageAge = answers.blockUnverifiedPackageAge;
  config.policy.blockNewInstallScripts = answers.blockNewInstallScripts;
  config.agents.instructionFiles = answers.agentInstructions;
  config.agents.shellShims = answers.repoShims;
  config.agents.ciEnforcement = answers.ciWorkflowHint;

  const actions = [
    { id: "config", label: `${CONFIG_FILE}`, enabled: true },
    { id: "agents", label: "AI agent instruction files", enabled: answers.agentInstructions },
    { id: "repo-shims", label: ".safe-install/bin package-manager shims", enabled: answers.repoShims },
    { id: "package-json-guard", label: "package.json preinstall guard", enabled: answers.packageJsonGuard },
    { id: "global-shims", label: "global package-manager shims", enabled: answers.globalShims },
  ];

  return {
    config,
    actions,
    capabilities: detectCapabilities(env),
  };
}

export async function applyOnboardingPlan(cwd, plan, context) {
  await writeFile(join(cwd, CONFIG_FILE), renderConfig(plan.config), { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });

  if (isEnabled(plan, "agents")) {
    await writeAgentInstructions(cwd);
  }

  if (isEnabled(plan, "repo-shims")) {
    await writeShims(cwd);
  }

  if (isEnabled(plan, "package-json-guard")) {
    await writePackageJsonGuard(cwd);
  }

  if (isEnabled(plan, "global-shims")) {
    await installGlobalShims(["--apply"], context);
  }
}

function isEnabled(plan, id) {
  return plan.actions.some((action) => action.id === id && action.enabled);
}

async function promptForAnswers({ input, output }) {
  const rl = createInterface({ input, output });
  try {
    output.write(`${ONBOARDING_LOGO}\n\nsafe-install onboarding\n\n`);
    return {
      agentInstructions: await confirm(rl, "Add AI agent instructions?", true),
      repoShims: await confirm(rl, "Add repo-local package-manager shims?", true),
      packageJsonGuard: await confirm(rl, "Add package.json preinstall guard when package.json exists?", true),
      globalShims: await confirm(rl, "Install optional global shims in ~/.safe-install/shims?", false),
      minimumPackageAgeHours: await numberPrompt(rl, "Minimum package age in hours", 48),
      blockUnverifiedPackageAge: await confirm(rl, "Block packages when age cannot be verified?", false),
      blockNewInstallScripts: await confirm(rl, "Block newly introduced install/build scripts in lockfile diffs?", true),
      ciWorkflowHint: await confirm(rl, "Enable CI enforcement recommendations in policy?", true),
    };
  } finally {
    rl.close();
  }
}

async function confirm(rl, label, defaultValue) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  while (true) {
    const answer = (await rl.question(`${label} [${suffix}] `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
  }
}

async function numberPrompt(rl, label, defaultValue) {
  while (true) {
    const answer = (await rl.question(`${label} [${defaultValue}] `)).trim();
    if (!answer) return defaultValue;
    const parsed = Number(answer);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
}

function defaultAnswers() {
  return {
    agentInstructions: true,
    repoShims: true,
    packageJsonGuard: true,
    globalShims: false,
    minimumPackageAgeHours: 48,
    blockUnverifiedPackageAge: false,
    blockNewInstallScripts: true,
    ciWorkflowHint: true,
  };
}

function parseOnboardingOptions(args) {
  const options = {
    dryRun: false,
    defaults: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--defaults") {
      options.defaults = true;
    } else {
      throw new Error(`unknown onboarding option "${arg}"`);
    }
  }

  return options;
}

function formatOnboardingSummary(plan, { dryRun, env, showLogo }) {
  const lines = [
    ...(showLogo ? [ONBOARDING_LOGO, ""] : []),
    dryRun ? "Dry run: onboarding plan." : "Onboarding complete.",
    "",
    formatCapabilities(plan.capabilities || detectCapabilities(env)),
    "",
    "Selected actions:",
    ...plan.actions.map((action) => `- ${action.enabled ? "enable" : "skip"}: ${action.label}`),
    "",
    "Policy:",
    `- minimum package age: ${plan.config.policy.minimumPackageAgeHours}h`,
    `- block unverified package age: ${plan.config.policy.blockUnverifiedPackageAge}`,
    `- block new install scripts: ${plan.config.policy.blockNewInstallScripts}`,
  ];

  if (isEnabled(plan, "repo-shims")) {
    lines.push("", 'Repo shims: add export PATH="$PWD/.safe-install/bin:$PATH" for strict local enforcement.');
  }

  if (isEnabled(plan, "global-shims")) {
    lines.push("", 'Global shims: add export PATH="$HOME/.safe-install/shims:$PATH" before normal package managers.');
  }

  if (dryRun) {
    lines.push("", "No files were changed. Re-run without --dry-run to apply.");
  }

  return lines.join("\n");
}
