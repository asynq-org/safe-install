import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export const CONFIG_FILE = "safe-install.yaml";

export const DEFAULT_CONFIG = Object.freeze({
  sandbox: {
    backend: "docker",
    minimumIsolation: "strong",
    networkDuringBuild: "blocked",
    allowFallback: false,
    docker: {
      nodeImage: "node:22-bookworm-slim",
      bunImage: "oven/bun:1",
      memory: "2g",
      pidsLimit: 256,
    },
  },
  packageManagers: {
    javascript: {
      npm: true,
      pnpm: true,
      yarn: true,
      bun: true,
    },
  },
  policy: {
    minimumPackageAgeHours: 48,
    blockUnverifiedPackageAge: false,
    blockNewInstallScripts: true,
    allowedInstallScriptPackages: [],
    npmRegistry: "https://registry.npmjs.org",
  },
  agents: {
    instructionFiles: true,
    shellShims: true,
    ciEnforcement: true,
  },
});

export async function loadConfig(cwd) {
  const path = join(cwd, CONFIG_FILE);
  try {
    await access(path);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }

  const text = await readFile(path, "utf8");
  return mergeConfig(structuredClone(DEFAULT_CONFIG), parseKnownYaml(text));
}

export function renderDefaultConfig() {
  return renderConfig(DEFAULT_CONFIG);
}

export function renderConfig(config) {
  return `# safe-install project policy
# Local-first dependency install gate. No telemetry. No public dashboard.

sandbox:
  backend: ${config.sandbox.backend}
  minimumIsolation: ${config.sandbox.minimumIsolation}
  networkDuringBuild: ${config.sandbox.networkDuringBuild}
  allowFallback: ${config.sandbox.allowFallback}
  docker:
    nodeImage: ${config.sandbox.docker.nodeImage}
    bunImage: ${config.sandbox.docker.bunImage}
    memory: ${config.sandbox.docker.memory}
    pidsLimit: ${config.sandbox.docker.pidsLimit}

packageManagers:
  javascript:
    npm: ${config.packageManagers.javascript.npm}
    pnpm: ${config.packageManagers.javascript.pnpm}
    yarn: ${config.packageManagers.javascript.yarn}
    bun: ${config.packageManagers.javascript.bun}

policy:
  minimumPackageAgeHours: ${config.policy.minimumPackageAgeHours}
  blockUnverifiedPackageAge: ${config.policy.blockUnverifiedPackageAge}
  blockNewInstallScripts: ${config.policy.blockNewInstallScripts}
  allowedInstallScriptPackages: []
  npmRegistry: ${config.policy.npmRegistry}

agents:
  instructionFiles: ${config.agents.instructionFiles}
  shellShims: ${config.agents.shellShims}
  ciEnforcement: ${config.agents.ciEnforcement}
`;
}

function parseKnownYaml(text) {
  const parsed = {};
  const stack = [{ indent: -1, value: parsed }];

  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim() || withoutComment.trimStart().startsWith("#")) continue;

    const indent = withoutComment.match(/^\s*/)[0].length;
    const line = withoutComment.trim();
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();

    const parent = stack.at(-1).value;
    if (rawValue === undefined || rawValue === "") {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = coerceValue(rawValue);
    }
  }

  return parsed;
}

function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function mergeConfig(base, override) {
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key]) {
      base[key] = mergeConfig(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}
