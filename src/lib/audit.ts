import {
  checkProsePathReferences,
  crossCheckSnippets,
  generateFixPatches,
  resetFindingIds,
} from "./cross-check.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { checkEnvVarDrift } from "./env-drift.js";
import { fetchLocalRepoStructure, readLocalDocs } from "./fs-repo.js";
import {
  analyzeGitHubDocIssues,
  fetchGitHubRepoStructure,
  parseGitHubRepo,
  readGitHubDocs,
  type GitHubTarget,
} from "./github.js";
import { formatReportMarkdown } from "./report-format.js";
import { saveLatestReport } from "./report-store.js";
import type {
  AuditReport,
  AuditStepTrace,
  DocFile,
  Finding,
  RepoStructure,
} from "./types.js";

export {
  formatDevRelFixReport,
  formatReportMarkdown,
} from "./report-format.js";

export interface AuditOptions {
  /** Local filesystem path */
  path?: string;
  /** GitHub owner/repo or URL */
  github?: string;
  githubToken?: string;
  maxFiles?: number;
  /** Persist report for MCP resource audit://report/latest */
  storeLatest?: boolean;
}

function scoreFindings(findings: Finding[]): AuditReport["score"] {
  const score = { critical: 0, high: 0, medium: 0, low: 0, total: findings.length };
  for (const f of findings) score[f.severity] += 1;
  return score;
}

async function timed<T>(
  step: string,
  tool: string,
  summaryOf: (result: T) => string,
  fn: () => Promise<T>,
  trace: AuditStepTrace[],
): Promise<T> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const result = await fn();
  trace.push({
    step,
    tool,
    startedAt,
    durationMs: Date.now() - started,
    summary: summaryOf(result),
  });
  return result;
}

/** Accept either a local path or a GitHub URL / owner/repo in `path` or `github`. */
export function resolveAuditTarget(options: AuditOptions): {
  path?: string;
  github?: string;
} {
  let pathOpt = options.path;
  let githubOpt = options.github;

  if (pathOpt && !githubOpt) {
    const isGitHubUrl = /^https?:\/\/github\.com\//i.test(pathOpt);
    const localExists = existsSync(path.resolve(pathOpt));
    // Only treat bare owner/repo as GitHub when it is NOT an existing local path
    const isBareOwnerRepo =
      !localExists && /^[\w.-]+\/[\w.-]+$/.test(pathOpt) && !pathOpt.includes("\\");

    if (isGitHubUrl || isBareOwnerRepo) {
      try {
        parseGitHubRepo(pathOpt);
        githubOpt = pathOpt;
        pathOpt = undefined;
      } catch {
        // keep as local path
      }
    }
  }

  return { path: pathOpt, github: githubOpt };
}

export async function runFullAudit(options: AuditOptions): Promise<AuditReport> {
  resetFindingIds();
  const trace: AuditStepTrace[] = [];
  const resolved = resolveAuditTarget(options);

  if (!resolved.path && !resolved.github) {
    throw new Error("Provide --path <dir> or --github owner/repo (URL also accepted)");
  }

  let structure: RepoStructure;
  let docs: DocFile[];
  let githubTarget: GitHubTarget | undefined;
  let targetLabel: string;

  if (resolved.path) {
    targetLabel = resolved.path;
    structure = await timed(
      "1. Fetch repo structure",
      "fetch_repo_structure",
      (s) => `${s.totalFiles} files (local${s.truncated ? ", truncated" : ""})`,
      () => fetchLocalRepoStructure(resolved.path!, { maxFiles: options.maxFiles }),
      trace,
    );
    docs = await timed(
      "2. Read documentation",
      "read_docs",
      (d) => `${d.length} doc file(s), ${d.reduce((n, x) => n + x.bytes, 0)} bytes`,
      () => readLocalDocs(resolved.path!, structure),
      trace,
    );
  } else {
    githubTarget = parseGitHubRepo(resolved.github!);
    targetLabel = `${githubTarget.owner}/${githubTarget.repo}`;
    structure = await timed(
      "1. Fetch repo structure",
      "fetch_repo_structure",
      (s) => `${s.totalFiles} files (github${s.truncated ? ", truncated" : ""})`,
      () =>
        fetchGitHubRepoStructure(githubTarget!, {
          maxFiles: options.maxFiles,
          token: options.githubToken,
        }),
      trace,
    );
    docs = await timed(
      "2. Read documentation",
      "read_docs",
      (d) => `${d.length} doc file(s)`,
      () =>
        readGitHubDocs(githubTarget!, structure, { token: options.githubToken }),
      trace,
    );
  }

  const snippetResults = await timed(
    "3. Cross-check snippets vs code",
    "cross_check_snippets",
    (r) =>
      `${r.length} snippet(s), ${r.reduce((n, x) => n + x.findings.length, 0)} finding(s)`,
    () => crossCheckSnippets(docs, structure, { github: githubTarget }),
    trace,
  );

  const proseFindings = await timed(
    "4. Check prose path references",
    "cross_check_snippets",
    (f) => `${f.length} prose finding(s)`,
    () => checkProsePathReferences(docs, structure),
    trace,
  );

  const envFindings = await timed(
    "5. Check environment variable drift",
    "check_env_drift",
    (f) => `${f.length} env finding(s)`,
    () => checkEnvVarDrift(docs, structure, { github: githubTarget }),
    trace,
  );

  const issueFindings: Finding[] = [];
  if (githubTarget) {
    const issues = await timed(
      "6. Analyze open docs-related issues",
      "analyze_open_issues",
      (i) => `${i.length} open docs-related issue(s)`,
      () => analyzeGitHubDocIssues(githubTarget!, options.githubToken),
      trace,
    );
    for (const issue of issues) {
      issueFindings.push({
        id: `issue-${issue.number}`,
        severity: "low",
        category: "docs_gap",
        title: `Open docs issue #${issue.number}: ${issue.title}`,
        detail: `Labels: ${issue.labels.join(", ") || "none"}. URL: ${issue.url}`,
        suggestion:
          "Triage whether this issue maps to a missing quickstart step, broken snippet, or API gap — then ship a docs PR.",
      });
    }
  } else {
    trace.push({
      step: "6. Analyze open docs-related issues",
      tool: "analyze_open_issues",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      summary: "Skipped (local path; pass --github to enable)",
    });
  }

  const findings = [
    ...snippetResults.flatMap((r) => r.findings),
    ...proseFindings,
    ...envFindings,
    ...issueFindings,
  ];

  const patches = await timed(
    "7. Generate fix patches",
    "generate_fix_patch",
    (p) => `${p.length} proposed patch(es)`,
    async () => generateFixPatches(docs, findings, structure),
    trace,
  );

  const report: AuditReport = {
    target: targetLabel,
    source: structure.source,
    generatedAt: new Date().toISOString(),
    structure,
    docs,
    snippetsChecked: snippetResults.length,
    findings,
    patches,
    trace,
    score: scoreFindings(findings),
  };

  if (options.storeLatest !== false) {
    saveLatestReport(report, formatReportMarkdown(report));
  }

  return report;
}
