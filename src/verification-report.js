export function formatVerificationReport(report) {
  const lines = [
    "safe-install verification report",
    "",
    `Status: ${report.status}`,
    `Base ref: ${report.baseRef}`,
    `Docker: ${report.capabilities.docker.available ? "available" : "unavailable"}`,
    "",
    "Changed dependency files:",
  ];

  if (report.diff.changedFiles.length === 0) {
    lines.push("- none");
  } else {
    for (const file of report.diff.changedFiles) lines.push(`- ${file}`);
  }

  if (report.diff.packageJson.directDependencyChanges.length > 0) {
    lines.push("", "Direct dependency changes:");
    for (const change of report.diff.packageJson.directDependencyChanges) {
      lines.push(`- ${change.status}: ${change.section}.${change.name} ${change.before || "-"} -> ${change.after || "-"}`);
    }
  }

  if (report.diff.packageChanges.length > 0) {
    lines.push("", "Lockfile package changes:");
    for (const change of report.diff.packageChanges.slice(0, 80)) {
      const entry = change.current || change.previous;
      const version = entry?.version || "?";
      lines.push(`- ${change.status}: ${entry?.name || "unknown"}@${version} (${change.lockfile})`);
    }
    if (report.diff.packageChanges.length > 80) {
      lines.push(`- ... ${report.diff.packageChanges.length - 80} more`);
    }
  }

  if (report.diff.installScriptFindings.length > 0) {
    lines.push("", "Install/build script findings:");
    for (const finding of report.diff.installScriptFindings) lines.push(`- ${finding.reason}`);
  }

  if (report.packageAge.checks.length > 0) {
    lines.push("", "Package age checks:");
    for (const check of report.packageAge.checks.slice(0, 80)) {
      lines.push(`- ${check.name}@${check.version}: ${check.ageHours}h old (minimum ${check.minimumHours}h)`);
    }
    if (report.packageAge.checks.length > 80) {
      lines.push(`- ... ${report.packageAge.checks.length - 80} more`);
    }
  }

  if (report.packageAge.skipped?.length > 0) {
    lines.push("", "Package age skipped:");
    for (const skipped of report.packageAge.skipped.slice(0, 30)) {
      lines.push(`- ${skipped.name}@${skipped.version}: ${skipped.reason}`);
    }
  }

  if (report.packageAge.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.packageAge.warnings) lines.push(`- ${warning}`);
  }

  if (report.violations.length > 0) {
    lines.push("", "Violations:");
    for (const violation of report.violations) lines.push(`- ${violation.reason}`);
  }

  if (report.notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of report.notes) lines.push(`- ${note}`);
  }

  return lines.join("\n");
}
