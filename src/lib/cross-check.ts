import path from "node:path";
import { nextFindingId, resetFindingIds } from "./ids.js";
import {
  extractNpmScripts,
  extractPathReferences,
  extractSnippets,
} from "./markdown.js";
import { fileExistsInStructure, readTextFile } from "./fs-repo.js";
import { fetchGitHubFileText, type GitHubTarget } from "./github.js";
import {
  findCallSites,
  parseExportedSymbols,
} from "./signatures.js";
import type {
  DocFile,
  Finding,
  FixPatch,
  RepoStructure,
  SnippetCheckResult,
} from "./types.js";

export { resetFindingIds };

function nextId(prefix: string): string {
  return nextFindingId(prefix);
}

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|mjs|cjs)$/i;

async function readSourceFile(
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

function resolveImportPath(
  fromDocSnippet: string,
  importPath: string,
  structure: RepoStructure,
): string | null {
  // Only handle relative imports for existence checks
  if (!importPath.startsWith(".")) return null;
  // Snippets often invent a file context; try common roots
  const guesses = [
    importPath.replace(/^\.\//, ""),
    path.posix.normalize(`src/${importPath.replace(/^\.\//, "")}`),
    path.posix.normalize(importPath.replace(/^\.\//, "")),
  ];

  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.js"];
  for (const guess of guesses) {
    for (const ext of extensions) {
      const candidate = guess.endsWith(".ts") || guess.endsWith(".js")
        ? guess
        : guess + ext;
      const normalized = candidate.replace(/^\.\//, "");
      if (fileExistsInStructure(structure, normalized)) return normalized;
    }
  }
  void fromDocSnippet;
  return null;
}

function parseNamedImports(code: string): Array<{ names: string[]; importPath: string }> {
  const results: Array<{ names: string[]; importPath: string }> = [];
  for (const match of code.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*["'](\.?\.?\/[^"']+)["']/g,
  )) {
    const names = match[1]
      .split(",")
      .map((n) =>
        n
          .trim()
          .split(/\s+as\s+/)
          .pop()!
          .replace(/^type\s+/, "")
          .trim(),
      )
      .filter(Boolean);
    results.push({ names, importPath: match[2] });
  }
  return results;
}

function similarity(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.8;
  const al = left.replace(/[^a-z0-9]/g, "");
  const bl = right.replace(/[^a-z0-9]/g, "");
  if (!al || !bl) return 0;
  let shared = 0;
  const shorter = al.length < bl.length ? al : bl;
  const longer = al.length < bl.length ? bl : al;
  for (const ch of shorter) {
    if (longer.includes(ch)) shared += 1;
  }
  return shared / longer.length;
}

/** Scan source files for export names that look like the documented symbol. */
export async function findLikelyExports(
  symbol: string,
  structure: RepoStructure,
  github?: GitHubTarget,
  limit = 5,
): Promise<Array<{ path: string; exportName: string; score: number }>> {
  const hits: Array<{ path: string; exportName: string; score: number }> = [];
  const candidates = structure.files
    .filter((f) => f.type === "file" && SOURCE_EXT.test(f.path))
    .map((f) => f.path)
    .slice(0, 80);

  for (const rel of candidates) {
    const source = await readSourceFile(structure, rel, github);
    if (!source) continue;
    const exports = parseExportedSymbols(source);
    for (const exp of exports) {
      const score = similarity(symbol, exp.name);
      if (score >= 0.45) {
        hits.push({ path: rel, exportName: exp.name, score });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

export async function crossCheckSnippets(
  docs: DocFile[],
  structure: RepoStructure,
  options: { github?: GitHubTarget } = {},
): Promise<SnippetCheckResult[]> {
  const snippets = extractSnippets(docs);
  const results: SnippetCheckResult[] = [];

  let packageScripts: Set<string> | null = null;
  if (fileExistsInStructure(structure, "package.json")) {
    const pkgText = await readSourceFile(structure, "package.json", options.github);
    if (pkgText) {
      try {
        const pkg = JSON.parse(pkgText) as { scripts?: Record<string, string> };
        packageScripts = new Set(Object.keys(pkg.scripts ?? {}));
      } catch {
        packageScripts = new Set();
      }
    }
  }

  for (const snippet of snippets) {
    const findings: Finding[] = [];

    // Path references inside the snippet
    for (const ref of extractPathReferences(snippet.code)) {
      const exists =
        fileExistsInStructure(structure, ref) ||
        resolveImportPath(snippet.docPath, `./${ref}`, structure) !== null;
      if (!exists) {
        const symbolGuess = path.posix
          .basename(ref)
          .replace(/\.[^.]+$/, "")
          .replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase());
        const likely = SOURCE_EXT.test(ref)
          ? await findLikelyExports(symbolGuess, structure, options.github)
          : [];
        const top = likely[0];
        findings.push({
          id: nextId("path"),
          severity: "high",
          category: "missing_file",
          title: `Documented path not found: ${ref}`,
          detail: `Snippet in ${snippet.docPath}:${snippet.startLine} references \`${ref}\`, but that file is not in the repo tree.`,
          docPath: snippet.docPath,
          docLine: snippet.startLine,
          relatedPath: top?.path ?? ref,
          suggestion: top
            ? `Likely replacement: \`${top.path}\` (exports \`${top.exportName}\`). Update the docs path or add the missing file.`
            : `Update the docs to the real path, or add the missing file. Search the tree for a similarly named module.`,
        });
      }
    }

    // Relative imports (+ suggest real modules when the documented path is invented)
    const namedImports = parseNamedImports(snippet.code);
    for (const match of snippet.code.matchAll(
      /(?:from|import)\s+["'](\.[^"']+)["']/g,
    )) {
      const importPath = match[1];
      const resolved = resolveImportPath(snippet.docPath, importPath, structure);
      if (!resolved) {
        const relatedNames =
          namedImports.find((n) => n.importPath === importPath)?.names ?? [];
        let suggestion =
          "Point the import at an existing module, or drop the invented path from the quickstart.";
        let relatedPath: string | undefined;
        if (relatedNames[0]) {
          const likely = await findLikelyExports(
            relatedNames[0],
            structure,
            options.github,
          );
          if (likely[0]) {
            relatedPath = likely[0].path;
            suggestion = `Replace import of \`${relatedNames[0]}\` from \`${importPath}\` with \`{ ${likely[0].exportName} }\` from \`./${likely[0].path}\`.`;
          }
        }
        findings.push({
          id: nextId("import"),
          severity: "high",
          category: "missing_file",
          title: `Import path does not resolve: ${importPath}`,
          detail: `Code fence at ${snippet.docPath}:${snippet.startLine} imports \`${importPath}\`, which does not match any file in the repository.`,
          docPath: snippet.docPath,
          docLine: snippet.startLine,
          relatedPath,
          suggestion,
        });
      }
    }

    // npm script commands
    if (snippet.kind === "shell" && packageScripts) {
      for (const script of extractNpmScripts(snippet.code)) {
        if (!packageScripts.has(script)) {
          const close = [...packageScripts].find(
            (s) => s.includes(script) || script.includes(s),
          );
          findings.push({
            id: nextId("cmd"),
            severity: "critical",
            category: "broken_command",
            title: `npm script "${script}" does not exist`,
            detail: `Docs tell developers to run \`${script}\`, but package.json scripts are: ${[...packageScripts].join(", ") || "(none)"}.`,
            docPath: snippet.docPath,
            docLine: snippet.startLine,
            suggestion: close
              ? `Replace \`${script}\` with \`${close}\` (closest match in package.json).`
              : `Add a "${script}" script to package.json, or document the real command.`,
          });
        }
      }
    }

    // Export names claimed in TypeScript/JS snippets vs referenced local files
    if (
      snippet.kind === "code" ||
      ["ts", "tsx", "js", "javascript", "typescript"].includes(snippet.language)
    ) {
      for (const { names, importPath } of namedImports) {
        const resolved = resolveImportPath(snippet.docPath, importPath, structure);
        if (!resolved) continue;
        const source = await readSourceFile(structure, resolved, options.github);
        if (!source) continue;
        const exportedSymbols = parseExportedSymbols(source);
        const exports = new Set(exportedSymbols.map((s) => s.name));
        for (const name of names) {
          if (!exports.has(name)) {
            const likely = await findLikelyExports(name, structure, options.github);
            const alt = likely.find((h) => h.exportName !== name) ?? likely[0];
            findings.push({
              id: nextId("export"),
              severity: "critical",
              category: "missing_export",
              title: `Import "${name}" is not exported from ${resolved}`,
              detail: `Quickstart imports \`{ ${name} }\` from \`${importPath}\`, but \`${resolved}\` does not export that symbol.`,
              docPath: snippet.docPath,
              docLine: snippet.startLine,
              relatedPath: alt?.path ?? resolved,
              suggestion: alt
                ? `Replace \`{ ${name} }\` with \`{ ${alt.exportName} }\` from \`./${alt.path}\`.`
                : `Update the docs to the real export name(s), or rename the export in code to match the docs.`,
            });
            continue;
          }

          const symbol = exportedSymbols.find((s) => s.name === name);
          if (!symbol || symbol.kind !== "function") continue;
          for (const call of findCallSites(snippet.code)) {
            if (call.name !== name) continue;
            if (call.argCount < symbol.requiredParamCount) {
              findings.push({
                id: nextId("arity"),
                severity: "high",
                category: "arity_mismatch",
                title: `Call to ${name}() has too few arguments`,
                detail: `Docs call \`${name}(...)\` with ${call.argCount} argument(s), but \`${resolved}\` exports \`${symbol.signature}\` requiring ${symbol.requiredParamCount}.`,
                docPath: snippet.docPath,
                docLine: snippet.startLine,
                relatedPath: resolved,
                suggestion: `Update the quickstart call to match \`${symbol.signature}\`.`,
              });
            } else if (call.argCount > symbol.paramCount) {
              findings.push({
                id: nextId("arity"),
                severity: "medium",
                category: "arity_mismatch",
                title: `Call to ${name}() has too many arguments`,
                detail: `Docs call \`${name}(...)\` with ${call.argCount} argument(s), but \`${resolved}\` exports \`${symbol.signature}\` with ${symbol.paramCount} parameter(s).`,
                docPath: snippet.docPath,
                docLine: snippet.startLine,
                relatedPath: resolved,
                suggestion: `Remove extra arguments or update the export signature in docs.`,
              });
            }
          }
        }
      }
    }

    results.push({ snippet, findings });
  }

  return results;
}

export async function checkProsePathReferences(
  docs: DocFile[],
  structure: RepoStructure,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const doc of docs) {
    for (const ref of extractPathReferences(doc.content)) {
      // Skip refs that only appear inside fences — snippets handle those
      const fenceBlocks = extractSnippets([doc]);
      const inFence = fenceBlocks.some((s) => s.code.includes(ref));
      if (inFence) continue;
      if (!fileExistsInStructure(structure, ref)) {
        const line =
          doc.content.split(/\r?\n/).findIndex((l) => l.includes(ref)) + 1 ||
          undefined;
        findings.push({
          id: nextId("prose"),
          severity: "medium",
          category: "missing_doc",
          title: `Referenced file missing: ${ref}`,
          detail: `${doc.path} mentions \`${ref}\` in prose, but the file is not in the repo.`,
          docPath: doc.path,
          docLine: line,
          relatedPath: ref,
          suggestion: `Add \`${ref}\` or remove/replace the reference.`,
        });
      }
    }
  }
  return findings;
}

export function generateFixPatches(
  docs: DocFile[],
  findings: Finding[],
  structure: RepoStructure,
): FixPatch[] {
  const patches: FixPatch[] = [];

  for (const finding of findings) {
    if (!finding.docPath) continue;
    const doc = docs.find((d) => d.path === finding.docPath);
    if (!doc) continue;

    if (finding.category === "broken_command") {
      const match = finding.suggestion.match(/Replace `([^`]+)` with `([^`]+)`/);
      if (match) {
        const [, from, to] = match;
        if (doc.content.includes(from)) {
          patches.push({
            path: doc.path,
            rationale: finding.title,
            before: extractContext(doc.content, from),
            after: extractContext(doc.content, from).replaceAll(from, to),
          });
        }
      }
    }

    const rewrite = finding.suggestion.match(
      /Replace import of `([^`]+)` from `([^`]+)` with `\{ ([^`]+) \}` from `([^`]+)`/,
    );
    if (rewrite) {
      const [, fromName, fromPath, toName, toPath] = rewrite;
      const importLine = doc.content
        .split(/\r?\n/)
        .find(
          (line) =>
            line.includes("import") &&
            line.includes(fromName) &&
            line.includes(fromPath.replace(/^\.\//, "")),
        );
      if (importLine) {
        const before = extractContext(doc.content, importLine.trim());
        const after = before.replace(
          importLine.trim(),
          `import { ${toName} } from "${toPath}";`,
        );
        patches.push({
          path: doc.path,
          rationale: finding.title,
          before,
          after,
        });
      }
    }

    const exportRewrite = finding.suggestion.match(
      /Replace `\{ ([^`]+) \}` with `\{ ([^`]+) \}` from `([^`]+)`/,
    );
    if (finding.category === "missing_export" && exportRewrite) {
      const [, fromName, toName, toPath] = exportRewrite;
      const before = extractContext(doc.content, fromName);
      patches.push({
        path: doc.path,
        rationale: finding.title,
        before,
        after: before
          .replaceAll(`{ ${fromName} }`, `{ ${toName} }`)
          .replaceAll(fromName, toName)
          .replace(/from\s+["'][^"']+["']/, `from "${toPath}"`),
      });
    } else if (finding.category === "missing_export" && finding.relatedPath) {
      patches.push({
        path: doc.path,
        rationale: finding.title,
        before: `import { … } // see ${finding.docPath}:${finding.docLine}`,
        after: `// Fix: align imported symbol with exports in ${finding.relatedPath}\n// ${finding.suggestion}`,
      });
    }

    // Path-only prose refs (e.g. docs/auth.md). Source import rewrites are handled above.
    if (
      finding.category === "missing_file" &&
      finding.relatedPath &&
      !rewrite &&
      !SOURCE_EXT.test(finding.relatedPath) &&
      doc.content.includes(finding.relatedPath)
    ) {
      const base = path.posix
        .basename(finding.relatedPath)
        .replace(/\.[^.]+$/, "")
        .toLowerCase();
      const similar = structure.files
        .filter((f) => f.type === "file")
        .map((f) => f.path)
        .filter((p) => path.posix.basename(p).toLowerCase().includes(base))
        .slice(0, 3);
      if (similar[0]) {
        patches.push({
          path: doc.path,
          rationale: finding.title,
          before: extractContext(doc.content, finding.relatedPath),
          after: extractContext(doc.content, finding.relatedPath).replaceAll(
            finding.relatedPath,
            similar[0],
          ),
        });
      }
    }
  }

  // Dedupe by path+before
  const seen = new Set<string>();
  return patches.filter((p) => {
    const key = `${p.path}::${p.before}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractContext(content: string, needle: string): string {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) return needle;
  const start = Math.max(0, idx - 1);
  const end = Math.min(lines.length, idx + 2);
  return lines.slice(start, end).join("\n");
}
