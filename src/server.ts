import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  formatDevRelFixReport,
  formatReportMarkdown,
  runFullAudit,
} from "./lib/audit.js";
import {
  checkProsePathReferences,
  crossCheckSnippets,
  resetFindingIds,
} from "./lib/cross-check.js";
import { fetchLocalRepoStructure, readLocalDocs } from "./lib/fs-repo.js";
import {
  analyzeGitHubDocIssues,
  fetchGitHubRepoStructure,
  parseGitHubRepo,
  readGitHubDocs,
} from "./lib/github.js";
import { applyDocPatches, toUnifiedDiff } from "./lib/patch.js";
import { getLatestReport, slimReport } from "./lib/report-store.js";
import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
} from "./lib/mcp-meta.js";

export { MCP_PROMPT_NAMES, MCP_RESOURCE_URIS, MCP_TOOL_NAMES };

const targetPath = z
  .string()
  .optional()
  .describe("Absolute or relative local path to a git checkout");

const githubTarget = z
  .string()
  .optional()
  .describe(
    "GitHub repo as owner/repo or https://github.com/owner/repo (public repos via GitHub API)",
  );

function textResult(payload: unknown) {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text" as const, text }],
  };
}

function requireTarget(path?: string, github?: string): string | null {
  if (!path && !github) return "Provide path or github";
  return null;
}

export function createDocsAuditorServer(): McpServer {
  const server = new McpServer({
    name: "docs-auditor-mcp",
    version: "1.1.0",
  });

  server.registerTool(
    "fetch_repo_structure",
    {
      title: "Fetch repo structure",
      description:
        "List files in a local directory or GitHub repository. Use this first before reading docs.",
      inputSchema: {
        path: targetPath,
        github: githubTarget,
        maxFiles: z
          .number()
          .int()
          .positive()
          .max(5000)
          .optional()
          .describe("Maximum file entries to return (default 2000)"),
      },
    },
    async ({ path, github, maxFiles }) => {
      const err = requireTarget(path, github);
      if (err) return textResult({ error: err });
      if (path) {
        const structure = await fetchLocalRepoStructure(path, { maxFiles });
        return textResult(structure);
      }
      const target = parseGitHubRepo(github!);
      const structure = await fetchGitHubRepoStructure(target, { maxFiles });
      return textResult(structure);
    },
  );

  server.registerTool(
    "read_docs",
    {
      title: "Read documentation",
      description:
        "Read README and docs/* from a local path or GitHub repo. Call after fetch_repo_structure.",
      inputSchema: {
        path: targetPath,
        github: githubTarget,
      },
    },
    async ({ path, github }) => {
      const err = requireTarget(path, github);
      if (err) return textResult({ error: err });
      if (path) {
        const structure = await fetchLocalRepoStructure(path);
        const docs = await readLocalDocs(path, structure);
        return textResult(
          docs.map((d) => ({
            path: d.path,
            bytes: d.bytes,
            preview: d.content.slice(0, 4000),
          })),
        );
      }
      const target = parseGitHubRepo(github!);
      const structure = await fetchGitHubRepoStructure(target);
      const docs = await readGitHubDocs(target, structure);
      return textResult(
        docs.map((d) => ({
          path: d.path,
          bytes: d.bytes,
          preview: d.content.slice(0, 4000),
        })),
      );
    },
  );

  server.registerTool(
    "cross_check_snippets",
    {
      title: "Cross-check snippets",
      description:
        "Extract fenced code blocks from docs and verify referenced files, imports, exports, call arity, and npm scripts against the repo.",
      inputSchema: {
        path: targetPath,
        github: githubTarget,
      },
    },
    async ({ path, github }) => {
      resetFindingIds();
      const err = requireTarget(path, github);
      if (err) return textResult({ error: err });
      if (path) {
        const structure = await fetchLocalRepoStructure(path);
        const docs = await readLocalDocs(path, structure);
        const snippetResults = await crossCheckSnippets(docs, structure);
        const prose = await checkProsePathReferences(docs, structure);
        return textResult({
          snippetsChecked: snippetResults.length,
          findings: [...snippetResults.flatMap((r) => r.findings), ...prose],
        });
      }
      const target = parseGitHubRepo(github!);
      const structure = await fetchGitHubRepoStructure(target);
      const docs = await readGitHubDocs(target, structure);
      const snippetResults = await crossCheckSnippets(docs, structure, {
        github: target,
      });
      const prose = await checkProsePathReferences(docs, structure);
      return textResult({
        snippetsChecked: snippetResults.length,
        findings: [...snippetResults.flatMap((r) => r.findings), ...prose],
      });
    },
  );

  server.registerTool(
    "analyze_open_issues",
    {
      title: "Analyze open docs issues",
      description:
        "Search open GitHub issues related to docs, README, or quickstart gaps.",
      inputSchema: {
        github: z
          .string()
          .min(1)
          .describe("GitHub repo as owner/repo or https://github.com/owner/repo"),
      },
    },
    async ({ github }) => {
      const target = parseGitHubRepo(github);
      const issues = await analyzeGitHubDocIssues(target);
      return textResult({ count: issues.length, issues });
    },
  );

  server.registerTool(
    "generate_fix_patch",
    {
      title: "Generate fix patches",
      description:
        "Propose concrete before/after doc patches for findings from a docs audit.",
      inputSchema: {
        path: targetPath,
        github: githubTarget,
      },
    },
    async ({ path, github }) => {
      const err = requireTarget(path, github);
      if (err) return textResult({ error: err });
      resetFindingIds();
      const report = await runFullAudit({ path, github });
      return textResult({
        findings: report.findings,
        patches: report.patches,
      });
    },
  );

  server.registerTool(
    "run_full_audit",
    {
      title: "Run full docs audit",
      description:
        "Run the full multi-step docs audit pipeline: structure → docs → cross-check → env drift → issues → fix patches. Returns markdown report + structured JSON. Also updates audit://report/latest.",
      inputSchema: {
        path: targetPath,
        github: githubTarget,
        format: z
          .enum(["markdown", "json", "both"])
          .optional()
          .default("both")
          .describe("Response format"),
      },
    },
    async ({ path, github, format }) => {
      const err = requireTarget(path, github);
      if (err) return textResult({ error: err });
      const report = await runFullAudit({ path, github, storeLatest: true });
      const slim = slimReport(report);
      if (format === "json") return textResult(slim);
      if (format === "markdown") return textResult(formatReportMarkdown(report));
      return textResult({
        markdown: formatReportMarkdown(report),
        report: slim,
      });
    },
  );

  server.registerTool(
    "apply_doc_patches",
    {
      title: "Apply doc patches",
      description:
        "Apply proposed documentation patches to a local checkout. Defaults to dryRun=true and returns unified diffs. Set dryRun=false to write files.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Local path to the repository root (writes only work locally)"),
        dryRun: z
          .boolean()
          .optional()
          .default(true)
          .describe("When true (default), only return unified diffs without writing"),
        runAuditFirst: z
          .boolean()
          .optional()
          .default(true)
          .describe("Re-run a full audit to collect patches before applying"),
      },
    },
    async ({ path, dryRun, runAuditFirst }) => {
      let patches =
        getLatestReport()?.json.patches.filter((p) =>
          Boolean(p.before && p.after && p.path),
        ) ?? [];

      if (runAuditFirst) {
        const report = await runFullAudit({ path, storeLatest: true });
        patches = report.patches;
      }

      if (!patches.length) {
        return textResult({
          dryRun,
          message: "No patches available to apply",
          files: [],
          written: [],
        });
      }

      const result = await applyDocPatches({
        root: path,
        patches,
        dryRun,
      });

      // Also emit per-patch unified diffs for small contexts
      const patchDiffs = patches.map((p) => ({
        path: p.path,
        rationale: p.rationale,
        diff: toUnifiedDiff(p.path, p.before, p.after),
      }));

      return textResult({
        ...result,
        patchDiffs,
      });
    },
  );

  server.registerPrompt(
    "audit-quickstart",
    {
      title: "Audit quickstart",
      description:
        "Run a full docs/quickstart audit and produce a DevRel-ready prioritized fix report.",
      argsSchema: {
        path: z
          .string()
          .optional()
          .describe("Local repository path to audit"),
        github: z
          .string()
          .optional()
          .describe("GitHub owner/repo or URL to audit"),
      },
    },
    async (args) => {
      const path = args.path;
      const github = args.github;
      if (!path && !github) {
        return {
          description: "Missing target",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: "Provide a local path or github repo to audit.",
              },
            },
          ],
        };
      }
      const report = await runFullAudit({ path, github, storeLatest: true });
      const fixReport = formatDevRelFixReport(report);
      return {
        description: `DevRel fix report for ${report.target}`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "You are a DevRel engineer. Use the audit below to write a clear fix plan for the product docs.",
                "Prioritize critical/high findings, propose exact README edits, and call out env/quickstart gaps.",
                "",
                fixReport,
                "",
                "Full markdown report is also available at resource URI audit://report/latest.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "fix-drift",
    {
      title: "Fix docs drift",
      description:
        "Guide the model to review unified diffs and apply documentation patches safely (dry-run first).",
      argsSchema: {
        path: z
          .string()
          .describe("Local repository path where patches may be applied"),
      },
    },
    async (args) => {
      const report = await runFullAudit({ path: args.path, storeLatest: true });
      const preview = await applyDocPatches({
        root: args.path,
        patches: report.patches,
        dryRun: true,
      });
      return {
        description: `Safe patch workflow for ${args.path}`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "You are helping apply documentation drift fixes safely.",
                "Rules:",
                "1. Review the unified diffs below.",
                "2. Only keep patches that are clearly correct.",
                "3. Call apply_doc_patches with dryRun=true again if needed.",
                "4. Only after human/approval intent, call apply_doc_patches with dryRun=false.",
                "5. Never rewrite unrelated sections.",
                "",
                `Findings: ${report.score.total} (${report.score.critical} critical, ${report.score.high} high)`,
                "",
                "### Dry-run diffs",
                "",
                preview.files.map((f) => f.diff).join("\n") || "_No file-level diffs_",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerResource(
    "latest-audit-report",
    MCP_RESOURCE_URIS[0],
    {
      title: "Latest audit report",
      description:
        "Most recent structured JSON + Markdown audit report produced by run_full_audit or prompts.",
      mimeType: "application/json",
    },
    async (uri) => {
      const latest = getLatestReport();
      if (!latest) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  error: "No audit report yet. Call run_full_audit or the audit-quickstart prompt first.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                savedAt: latest.savedAt,
                report: latest.json,
                markdown: latest.markdown,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}
