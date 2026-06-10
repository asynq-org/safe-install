import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export function detectCapabilities(env = process.env) {
  const docker = detectDocker(env);

  return {
    platform: process.platform,
    arch: process.arch,
    docker,
    podman: detectCommand("podman", ["--version"], env),
    firejail: detectCommand("firejail", ["--version"], env),
    bubblewrap: detectCommand("bwrap", ["--version"], env),
    lima: detectCommand("limactl", ["--version"], env),
  };
}

export function formatCapabilities(capabilities) {
  const rows = [
    `Detected platform: ${capabilities.platform} ${capabilities.arch}`,
    "",
    "Available sandbox backends:",
    formatBackend("docker", capabilities.docker),
    formatBackend("podman", capabilities.podman, "roadmap"),
    formatBackend("bubblewrap", capabilities.bubblewrap, "roadmap"),
    formatBackend("firejail", capabilities.firejail, "roadmap"),
    formatBackend("lima", capabilities.lima, "roadmap"),
    "",
    capabilities.docker.available
      ? "Recommended backend: docker, isolation: strong"
      : "Recommended backend: install Docker or a compatible VM backend before enabling strong isolation",
  ];

  if (capabilities.docker.installHint) {
    rows.push("", "Docker setup hint:", capabilities.docker.installHint);
  }

  return rows.join("\n");
}

function detectDocker(env) {
  const docker = detectCommand("docker", ["--version"], env);
  if (docker.available) {
    const daemon = detectCommand("docker", ["info"], env);
    return {
      ...docker,
      cliAvailable: true,
      daemonAvailable: daemon.available,
      available: daemon.available,
      installHint: daemon.available ? null : [
        "Docker CLI is installed, but the Docker daemon is not reachable.",
        "Start Docker Desktop or your Docker daemon, then retry:",
        "  docker ps",
        "  safe-install doctor",
        daemon.stderr ? `Last daemon error: ${daemon.stderr}` : null,
      ].filter(Boolean).join("\n"),
    };
  }

  if (process.platform !== "darwin") {
    return docker;
  }

  const desktopDocker = "/Applications/Docker.app/Contents/Resources/bin/docker";
  if (!existsSync(desktopDocker)) {
    return docker;
  }

  const desktop = detectCommand(desktopDocker, ["--version"], env);
  const hint = [
    "Docker Desktop is installed, but docker is not on PATH.",
    "Run:",
    '  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"',
    "Then retry:",
    "  docker ps",
    "  safe-install doctor",
    "To make it permanent:",
    '  echo \'export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"\' >> ~/.zshrc',
    "  exec zsh -l",
  ].join("\n");

  return {
    ...desktop,
    available: false,
    cliAvailable: false,
    daemonAvailable: false,
    installedButNotOnPath: true,
    path: desktopDocker,
    installHint: hint,
  };
}

function detectCommand(command, args, env) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
  });

  return {
    available: result.status === 0,
    command,
    version: result.status === 0 ? (result.stdout || result.stderr).trim() : null,
    stderr: result.status === 0 ? "" : (result.stderr || result.stdout || "").trim(),
  };
}

function formatBackend(name, capability, note = "") {
  let status = capability.available ? "available" : "not found";
  if (name === "docker" && capability.cliAvailable && !capability.daemonAvailable) {
    status = "cli found, daemon unavailable";
  }
  const suffix = note ? ` (${note})` : "";
  return `- ${name}: ${status}${suffix}`;
}
