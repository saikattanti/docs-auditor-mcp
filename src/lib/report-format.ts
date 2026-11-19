import type { AuditReport } from "./types.js";

export function formatReportMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# Docs Audit Report`);
  lines.push("");
  lines.push(`- **Target:** \`${report.target}\``);
  lines.push(`- **Source:** ${report.source}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(
    `- **Score:** ${report.score.total} findings (${report.score.critical} critical, ${report.score.high} high, ${report.score.medium} medium, ${report.score.low} low)`,
  );
  lines.push(`- **Docs read:** ${report.docs.map((d) => d.path).join(", ") || "(none)"}`);
  lines.push(`- **Snippets checked:** ${report.snippetsChecked}`);
  lines.push("");
  lines.push(`## Execution trace`);
  lines.push("");
  lines.push(`| Step | Tool | Duration | Summary |`);
  lines.push(`| --- | --- | ---: | --- |`);
  for (const t of report.trace) {
    lines.push(
      `| ${t.step} | \`${t.tool}\` | ${t.durationMs}ms | ${t.summary} |`,
    );
  }
  lines.push("");
  lines.push(`## Findings`);
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("_No documentation drift detected._");
  } else {
    for (const f of report.findings) {
      lines.push(`### ${f.id} · ${f.severity.toUpperCase()} · ${f.title}`);
      lines.push("");
      lines.push(f.detail);
      if (f.docPath) {
        lines.push("");
        lines.push(
          `- **Doc:** \`${f.docPath}\`${f.docLine ? `:${f.docLine}` : ""}`,
        );
      }
      if (f.relatedPath) lines.push(`- **Related:** \`${f.relatedPath}\``);
      lines.push(`- **Fix:** ${f.suggestion}`);
      lines.push("");
    }
  }

  if (report.patches.length) {
    lines.push(`## Proposed patches`);
    lines.push("");
    for (const [i, p] of report.patches.entries()) {
      lines.push(`### Patch ${i + 1}: \`${p.path}\``);
      lines.push("");
      lines.push(p.rationale);
      lines.push("");
      lines.push("```diff");
      lines.push(`# before`);
      for (const line of p.before.split("\n")) lines.push(`- ${line}`);
      lines.push(`# after`);
      for (const line of p.after.split("\n")) lines.push(`+ ${line}`);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatDevRelFixReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# DevRel Fix Report`);
  lines.push("");
  lines.push(`Target: \`${report.target}\` · ${report.score.total} finding(s)`);
  lines.push("");
  lines.push(`## Priority fixes`);
  lines.push("");
  const ordered = [...report.findings].sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    return rank[a.severity] - rank[b.severity];
  });
  if (!ordered.length) {
    lines.push("No docs drift found. Quickstart looks consistent with the codebase.");
  } else {
    for (const f of ordered) {
      lines.push(`1. **[${f.severity}] ${f.title}**`);
      lines.push(`   - ${f.detail}`);
      lines.push(`   - Suggested fix: ${f.suggestion}`);
      lines.push("");
    }
  }
  if (report.patches.length) {
    lines.push(`## Ready-to-apply patches`);
    lines.push("");
    lines.push(
      `Use the \`apply_doc_patches\` tool with \`dryRun: true\` first, then \`dryRun: false\` after review.`,
    );
    lines.push("");
    for (const [i, p] of report.patches.entries()) {
      lines.push(`${i + 1}. \`${p.path}\` — ${p.rationale}`);
    }
  }
  return lines.join("\n");
}
