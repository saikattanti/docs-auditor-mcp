#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { formatReportMarkdown, runFullAudit } from "./lib/audit.js";
import { slimReport } from "./lib/report-store.js";
import type { Severity } from "./lib/types.js";

type OutputFormat = "json" | "markdown";
type FailOn = "critical" | "high" | "medium" | "low" | "none";

function printHelp(): void {
  console.error(`docs-auditor — find README/docs drift against a real codebase

Usage:
  npx tsx src/cli.ts --path <dir> [--format json|markdown] [--fail-on high|critical] [--out report.md]
  npx tsx src/cli.ts --github owner/repo [--format json|markdown] [--fail-on high|critical]

Examples:
  npm run audit:fixture
  npx tsx src/cli.ts --path ./fixtures/drifted-sdk --format markdown --fail-on high
  npx tsx src/cli.ts --github vercel/ai --format json
  npx tsx src/cli.ts --path https://github.com/vercel/ai --format markdown

Flags:
  --path <dir|url>     Local checkout, or a GitHub URL / owner/repo
  --github <repo>      GitHub owner/repo or URL (GitHub API; no clone required)
  --format <fmt>       json | markdown (default: markdown). --json is an alias
  --fail-on <level>    Exit 2 when findings at this severity or worse exist
                       (critical | high | medium | low | none). Default: high
  --out <file>         Write report to a file as well as stdout
  --help               Show this help

Environment:
  GITHUB_TOKEN   Optional. Raises GitHub API rate limits for --github mode.
`);
}

function severityRank(level: Severity | "none"): number {
  switch (level) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 99;
  }
}

function shouldFail(
  score: { critical: number; high: number; medium: number; low: number },
  failOn: FailOn,
): boolean {
  if (failOn === "none") return false;
  const threshold = severityRank(failOn);
  if (threshold <= 0 && score.critical > 0) return true;
  if (threshold <= 1 && (score.critical > 0 || score.high > 0)) return true;
  if (threshold <= 2 && (score.critical > 0 || score.high > 0 || score.medium > 0))
    return true;
  if (
    threshold <= 3 &&
    (score.critical > 0 || score.high > 0 || score.medium > 0 || score.low > 0)
  ) {
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let targetPath: string | undefined;
  let github: string | undefined;
  let outFile: string | undefined;
  let format: OutputFormat = "markdown";
  let failOn: FailOn = "high";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--path") targetPath = args[++i];
    else if (arg === "--github") github = args[++i];
    else if (arg === "--out") outFile = args[++i];
    else if (arg === "--json") format = "json";
    else if (arg === "--format") {
      const value = args[++i];
      if (value !== "json" && value !== "markdown") {
        console.error(`Invalid --format: ${value}`);
        printHelp();
        process.exit(1);
      }
      format = value;
    } else if (arg === "--fail-on") {
      const value = args[++i] as FailOn;
      if (!["critical", "high", "medium", "low", "none"].includes(value)) {
        console.error(`Invalid --fail-on: ${value}`);
        printHelp();
        process.exit(1);
      }
      failOn = value;
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  const started = Date.now();
  console.error("Running docs audit…");
  const report = await runFullAudit({ path: targetPath, github });

  for (const step of report.trace) {
    console.error(
      `  [${step.durationMs.toString().padStart(4, " ")}ms] ${step.step} — ${step.summary}`,
    );
  }
  console.error(
    `Done in ${Date.now() - started}ms · ${report.score.total} finding(s) (${report.score.critical} critical)`,
  );

  const output =
    format === "json"
      ? JSON.stringify(slimReport(report), null, 2)
      : formatReportMarkdown(report);

  if (outFile) {
    const abs = path.resolve(outFile);
    await writeFile(abs, output, "utf8");
    console.error(`Wrote ${abs}`);
  }

  process.stdout.write(output.endsWith("\n") ? output : output + "\n");

  if (shouldFail(report.score, failOn)) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
