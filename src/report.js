export function formatReport(report) {
  const lines = [
    "safe-install sandbox report",
    "",
    `Command: ${report.command.join(" ")}`,
    `Status: ${report.status}`,
    `Sandbox: ${report.sandbox.backend}`,
    `Isolation: ${report.sandbox.isolation}`,
    `Sandbox duration: ${formatDuration(report.durationSeconds)}`,
    `Network during scripts: ${report.sandbox.networkDuringBuild}`,
    `Real secrets mounted: ${report.sandbox.realSecretsMounted ? "yes" : "no"}`,
    `Real project mounted: ${report.sandbox.realProjectMounted ? "yes" : "no"}`,
    "",
    "Phases:",
  ];

  for (const phase of report.phases) {
    lines.push(`- ${phase.name}: ${phase.status === 0 ? "ok" : `failed (${phase.status})`}`);
  }

  if (report.changedFiles.length > 0) {
    lines.push("", "Tracked dependency files changed:");
    for (const change of report.changedFiles) {
      lines.push(`- ${change.status}: ${change.path}`);
    }
  }

  if (report.packageAge?.checks?.length > 0) {
    lines.push("", "Package age checks:");
    for (const check of report.packageAge.checks) {
      lines.push(`- ${check.name}@${check.version}: ${check.ageHours}h old (minimum ${check.minimumHours}h)`);
    }
  }

  if (report.packageAge?.warnings?.length > 0) {
    lines.push("", "Package age warnings:");
    for (const warning of report.packageAge.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (report.packageAge?.violations?.length > 0) {
    lines.push("", "Package age violations:");
    for (const violation of report.packageAge.violations) {
      lines.push(`- ${violation.reason}`);
    }
  }

  if (report.suspiciousWrites.length > 0) {
    lines.push("", "Suspicious writes:");
    for (const write of report.suspiciousWrites) {
      lines.push(`- ${write.status}: ${write.path}`);
    }
  }

  if (report.notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
  }

  const failed = report.phases.filter((phase) => phase.status !== 0);
  for (const phase of failed) {
    if (phase.stderr) {
      lines.push("", `${phase.name} stderr:`, phase.stderr);
    }
  }

  return boxText(lines);
}

function formatDuration(value) {
  return `${Number(value || 0).toFixed(1)}s`;
}

const BOX_WIDTH = 88;
const BOX_INNER_WIDTH = BOX_WIDTH - 4;

function boxText(lines) {
  const border = `+${"-".repeat(BOX_WIDTH - 2)}+`;
  const boxed = [border];

  for (const line of lines) {
    for (const rawLine of String(line).split(/\r?\n/)) {
      const wrapped = wrapLine(rawLine, BOX_INNER_WIDTH);
      for (const part of wrapped) {
        boxed.push(`| ${part.padEnd(BOX_INNER_WIDTH, " ")} |`);
      }
    }
  }

  boxed.push(border);
  return boxed.join("\n");
}

function wrapLine(line, width) {
  if (!line) return [""];
  const parts = [];
  let remaining = line;

  while (remaining.length > width) {
    let index = remaining.lastIndexOf(" ", width);
    if (index <= 0) index = width;
    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }

  parts.push(remaining);
  return parts;
}
