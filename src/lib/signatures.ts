import type { ExportedSymbol } from "./types.js";

/**
 * Lightweight export / call-site parsers for JS/TS snippets.
 * Not a full TypeScript AST — good enough for quickstart arity checks.
 */

export function parseExportedSymbols(source: string): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const patterns: Array<{
    re: RegExp;
    kind: ExportedSymbol["kind"];
  }> = [
    {
      re: /export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g,
      kind: "function",
    },
    {
      re: /export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:extends\s+[^{]+)?\{/g,
      kind: "class",
    },
    {
      re: /export\s+(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g,
      kind: "function",
    },
    {
      re: /export\s+(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/g,
      kind: "function",
    },
    {
      re: /exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:function\s*)?\(([^)]*)\)/g,
      kind: "function",
    },
  ];

  for (const { re, kind } of patterns) {
    for (const match of source.matchAll(re)) {
      const name = match[1];
      const paramsRaw = match[2] ?? "";
      const { paramCount, requiredParamCount } = countParams(paramsRaw);
      symbols.push({
        name,
        kind,
        paramCount,
        requiredParamCount,
        signature:
          kind === "function"
            ? `${name}(${paramsRaw.trim()})`
            : name,
      });
    }
  }

  // export { foo, bar as baz }
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(",")) {
      const bits = part.trim();
      if (!bits) continue;
      const name = bits.split(/\s+as\s+/).pop()!.trim();
      if (!name || symbols.some((s) => s.name === name)) continue;
      symbols.push({
        name,
        kind: "unknown",
        paramCount: 0,
        requiredParamCount: 0,
        signature: name,
      });
    }
  }

  return symbols;
}

export function countParams(paramsRaw: string): {
  paramCount: number;
  requiredParamCount: number;
} {
  const trimmed = paramsRaw.trim();
  if (!trimmed) return { paramCount: 0, requiredParamCount: 0 };

  const parts = splitParams(trimmed);
  let required = 0;
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const optional = p.includes("=") || /\?\s*:/.test(p) || p.startsWith("...");
    if (!optional) required += 1;
  }
  return { paramCount: parts.filter((p) => p.trim()).length, requiredParamCount: required };
}

function splitParams(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of raw) {
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export interface CallSite {
  name: string;
  argCount: number;
  index: number;
}

/** Find `name(...)` call sites in a snippet (skips import lines). */
export function findCallSites(code: string): CallSite[] {
  const sites: CallSite[] = [];
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const match of code.matchAll(re)) {
    const name = match[1];
    if (
      ["if", "for", "while", "switch", "catch", "function", "return", "await", "new"].includes(
        name,
      )
    ) {
      continue;
    }
    const lineStart = code.lastIndexOf("\n", match.index ?? 0) + 1;
    const line = code.slice(lineStart, (match.index ?? 0) + name.length);
    if (/^\s*import\b/.test(line) || /\bfrom\b/.test(line)) continue;

    const openIdx = (match.index ?? 0) + match[0].length - 1;
    const argsRaw = extractArgList(code, openIdx);
    if (argsRaw === null) continue;
    const argCount = countArgs(argsRaw);
    sites.push({ name, argCount, index: match.index ?? 0 });
  }
  return sites;
}

function extractArgList(code: string, openParenIndex: number): string | null {
  if (code[openParenIndex] !== "(") return null;
  let depth = 0;
  for (let i = openParenIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(openParenIndex + 1, i);
    }
  }
  return null;
}

function countArgs(argsRaw: string): number {
  const trimmed = argsRaw.trim();
  if (!trimmed) return 0;
  return splitParams(trimmed).filter((p) => p.trim()).length;
}
