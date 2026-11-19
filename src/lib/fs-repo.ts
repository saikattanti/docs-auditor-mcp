import { promises as fs } from "node:fs";
import path from "node:path";
import type { DocFile, RepoFile, RepoStructure } from "./types.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);

const DOC_NAMES = new Set([
  "readme.md",
  "readme.rst",
  "contributing.md",
  "changelog.md",
  "quickstart.md",
  "getting-started.md",
]);

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function fetchLocalRepoStructure(
  root: string,
  options: { maxFiles?: number } = {},
): Promise<RepoStructure> {
  const maxFiles = options.maxFiles ?? 2000;
  const absolute = path.resolve(root);
  if (!(await pathExists(absolute))) {
    throw new Error(`Path not found: ${absolute}`);
  }

  const files: RepoFile[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (truncated) return;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(absolute, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        files.push({ path: rel + "/", type: "dir" });
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        files.push({ path: rel, type: "file", size: stat.size });
        if (files.filter((f) => f.type === "file").length >= maxFiles) {
          truncated = true;
          return;
        }
      }
    }
  }

  await walk(absolute);
  const fileOnly = files.filter((f) => f.type === "file");
  return {
    root: absolute,
    source: "local",
    files,
    totalFiles: fileOnly.length,
    truncated,
  };
}

export function listFilePaths(structure: RepoStructure): Set<string> {
  return new Set(
    structure.files.filter((f) => f.type === "file").map((f) => f.path),
  );
}

export async function readLocalDocs(
  root: string,
  structure: RepoStructure,
): Promise<DocFile[]> {
  const absolute = path.resolve(root);
  const candidates = structure.files
    .filter((f) => f.type === "file")
    .map((f) => f.path)
    .filter((p) => {
      const lower = p.toLowerCase();
      const base = path.posix.basename(lower);
      return (
        DOC_NAMES.has(base) ||
        lower.startsWith("docs/") ||
        lower.startsWith("doc/") ||
        lower.includes("/docs/")
      );
    })
    .filter((p) => /\.(md|mdx|rst|txt)$/i.test(p));

  // Prefer README first
  candidates.sort((a, b) => {
    const score = (p: string) =>
      path.posix.basename(p).toLowerCase() === "readme.md" ? 0 : 1;
    return score(a) - score(b) || a.localeCompare(b);
  });

  const docs: DocFile[] = [];
  for (const rel of candidates) {
    const full = path.join(absolute, rel);
    const content = await fs.readFile(full, "utf8");
    docs.push({ path: rel, content, bytes: Buffer.byteLength(content, "utf8") });
  }
  return docs;
}

export async function readTextFile(
  root: string,
  relPath: string,
): Promise<string | null> {
  const full = path.join(path.resolve(root), relPath);
  if (!(await pathExists(full))) return null;
  return fs.readFile(full, "utf8");
}

export function fileExistsInStructure(
  structure: RepoStructure,
  candidate: string,
): boolean {
  const normalized = candidate.replace(/^\.\//, "").replace(/\\/g, "/");
  const files = listFilePaths(structure);
  if (files.has(normalized)) return true;
  // Case-insensitive fallback for macOS-style repos documented on Linux CI
  const lower = normalized.toLowerCase();
  for (const f of files) {
    if (f.toLowerCase() === lower) return true;
  }
  return false;
}
