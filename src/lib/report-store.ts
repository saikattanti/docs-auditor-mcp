import type { AuditReport, SlimAuditReport } from "./types.js";

export interface StoredAuditReport {
  markdown: string;
  json: SlimAuditReport;
  savedAt: string;
}

let latest: StoredAuditReport | null = null;

export function slimReport(report: AuditReport): SlimAuditReport {
  return {
    target: report.target,
    source: report.source,
    generatedAt: report.generatedAt,
    score: report.score,
    snippetsChecked: report.snippetsChecked,
    docs: report.docs.map((d) => d.path),
    findings: report.findings,
    patches: report.patches,
    trace: report.trace,
  };
}

export function saveLatestReport(
  report: AuditReport,
  markdown: string,
): StoredAuditReport {
  latest = {
    markdown,
    json: slimReport(report),
    savedAt: new Date().toISOString(),
  };
  return latest;
}

export function getLatestReport(): StoredAuditReport | null {
  return latest;
}

export function clearLatestReport(): void {
  latest = null;
}
