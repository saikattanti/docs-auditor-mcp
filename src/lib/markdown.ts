import type { CodeSnippet, DocFile } from "./types.js";

export function extractSnippets(docs: DocFile[]): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];

  for (const doc of docs) {
    const lines = doc.content.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const open = lines[i].match(/^([ \t]*)(`{3,}|~{3,})([^\n`]*)$/);
      if (!open) {
        i += 1;
        continue;
      }
      const fence = open[2];
      const info = open[3].trim();
      const language = info.split(/\s+/)[0]?.toLowerCase() || "unknown";
      const startLine = i + 1;
      i += 1;
      const body: string[] = [];
      while (i < lines.length) {
        if (
          lines[i].match(new RegExp(`^[ \\t]*${escapeRegExp(fence)}[ \\t]*$`))
        ) {
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      const endLine = i + 1;
      const code = body.join("\n");
      snippets.push({
        docPath: doc.path,
        language,
        code,
        startLine,
        endLine,
        kind: classifySnippet(language, code),
      });
      i += 1;
    }
  }

  return snippets;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifySnippet(
  language: string,
  code: string,
): CodeSnippet["kind"] {
  if (["bash", "sh", "shell", "zsh", "console", "terminal"].includes(language)) {
    return "shell";
  }
  if (language === "json") return "json";
  if (
    language === "unknown" &&
    /^\s*(\$|npm |pnpm |yarn |npx |bun |cargo |pip |python |node )/m.test(code)
  ) {
    return "shell";
  }
  if (language === "unknown" || language === "") return "unknown";
  return "code";
}

/** Paths referenced in docs prose or snippets, e.g. `src/foo.ts` or docs/auth.md */
export function extractPathReferences(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /`((?:src|lib|app|docs|examples|packages|scripts|test|tests)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`/g,
    /`([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|md|json|yaml|yml))`/g,
    /(?:from|import)\s+["'](\.?\.?\/[^"']+)["']/g,
  ];

  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const raw = match[1].replace(/^\.\//, "");
      if (raw.includes("://")) continue;
      found.add(raw);
    }
  }
  return [...found];
}

export function extractNpmScripts(text: string): string[] {
  const scripts = new Set<string>();
  const re =
    /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+([a-zA-Z0-9:_-]+)\b/g;
  for (const match of text.matchAll(re)) {
    const name = match[1];
    if (name && !["install", "ci", "exec", "init"].includes(name)) {
      scripts.add(name);
    }
  }
  return [...scripts];
}

export function extractExportMentions(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    /export\s+(?:const|let|var|class|type|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      names.add(match[1]);
    }
  }
  return [...names];
}
