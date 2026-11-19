import { nextFindingId } from "./ids.js";
import { readTextFile } from "./fs-repo.js";
import { fetchGitHubFileText, type GitHubTarget } from "./github.js";
import type { DocFile, Finding, RepoStructure } from "./types.js";

const SOURCE_UNDER_SRC = /^src\/.*\.(?:[cm]?[jt]sx?|mjs|cjs)$/i;
const ENV_RE = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const ENV_BRACKET_RE = /process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g;

export interface EnvUsage {
  name: string;
  files: string[];
}

export function extractEnvVarsFromSource(source: string): string[] {
  const names = new Set<string>();
  for (const re of [ENV_RE, ENV_BRACKET_RE]) {
    for (const match of source.matchAll(re)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

export function parseEnvExample(content: string): Set<string> {
  const names = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (m) names.add(m[1]);
  }
  return names;
}

export function documentedEnvNames(docs: DocFile[]): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /`([A-Z][A-Z0-9_]{2,})`/g,
    /\b([A-Z][A-Z0-9_]{2,})\b/g,
  ];
  for (const doc of docs) {
    // Prefer README / quickstart for env documentation signals
    const base = doc.path.toLowerCase();
    if (
      !(
        base.endsWith("readme.md") ||
        base.includes("quickstart") ||
        base.includes("getting-started") ||
        base.startsWith("docs/")
      )
    ) {
      continue;
    }
    for (const re of patterns) {
      for (const match of doc.content.matchAll(re)) {
        const name = match[1];
        // Heuristic: env-like tokens
        if (/^[A-Z][A-Z0-9_]*$/.test(name) && name.includes("_")) {
          names.add(name);
        }
      }
    }
    for (const match of doc.content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

async function readRepoFile(
  structure: RepoStructure,
  relPath: string,
  github?: GitHubTarget,
): Promise<string | null> {
  if (structure.source === "local") {
    return readTextFile(structure.root, relPath);
  }
  if (github) {
    return fetchGitHubFileText(github, relPath);
  }
  return null;
}

/**
 * Flag `process.env.*` usages under `src/` that are missing from both
 * README/docs and `.env.example`.
 */
export async function checkEnvVarDrift(
  docs: DocFile[],
  structure: RepoStructure,
  options: { github?: GitHubTarget } = {},
): Promise<Finding[]> {
  const usages = new Map<string, Set<string>>();
  const sourceFiles = structure.files
    .filter((f) => f.type === "file" && SOURCE_UNDER_SRC.test(f.path))
    .map((f) => f.path)
    .slice(0, 200);

  for (const rel of sourceFiles) {
    const text = await readRepoFile(structure, rel, options.github);
    if (!text) continue;
    for (const name of extractEnvVarsFromSource(text)) {
      if (!usages.has(name)) usages.set(name, new Set());
      usages.get(name)!.add(rel);
    }
  }

  const documented = documentedEnvNames(docs);
  let envExample = new Set<string>();
  if (structure.files.some((f) => f.type === "file" && f.path === ".env.example")) {
    const raw = await readRepoFile(structure, ".env.example", options.github);
    if (raw) envExample = parseEnvExample(raw);
  }

  const findings: Finding[] = [];
  for (const [name, files] of [...usages.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const inDocs = documented.has(name);
    const inExample = envExample.has(name);
    if (inDocs && inExample) continue;

    if (!inDocs && !inExample) {
      findings.push({
        id: nextFindingId("env"),
        severity: "high",
        category: "env_drift",
        title: `Env var ${name} is used in code but undocumented`,
        detail: `\`${name}\` appears in ${[...files].join(", ")} via \`process.env\`, but is missing from README/docs and \`.env.example\`.`,
        relatedPath: [...files][0],
        suggestion: `Document \`${name}\` in the quickstart and add it to \`.env.example\`.`,
      });
      continue;
    }

    if (!inExample) {
      findings.push({
        id: nextFindingId("env"),
        severity: "medium",
        category: "env_drift",
        title: `Env var ${name} missing from .env.example`,
        detail: `\`${name}\` is used in ${[...files].join(", ")} and mentioned in docs, but \`.env.example\` does not list it.`,
        relatedPath: ".env.example",
        suggestion: `Add \`${name}=\` to \`.env.example\` so developers know which secrets to set.`,
      });
    }

    if (!inDocs) {
      findings.push({
        id: nextFindingId("env"),
        severity: "medium",
        category: "env_drift",
        title: `Env var ${name} missing from README/docs`,
        detail: `\`${name}\` is listed in \`.env.example\` and used in ${[...files].join(", ")}, but README/quickstart docs never mention it.`,
        docPath: docs.find((d) => d.path.toLowerCase().endsWith("readme.md"))?.path,
        suggestion: `Mention \`${name}\` in the quickstart environment section.`,
      });
    }
  }

  return findings;
}
