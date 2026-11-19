import { promises as fs } from "node:fs";
import path from "node:path";
import type { FixPatch } from "./types.js";

export interface UnifiedDiffFile {
  path: string;
  diff: string;
  applied: boolean;
}

export interface ApplyPatchesResult {
  dryRun: boolean;
  files: UnifiedDiffFile[];
  written: string[];
}

/** Build a unified diff for a single before/after hunk. */
export function toUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
  options: { context?: number } = {},
): string {
  if (before === after) {
    return `--- a/${filePath}\n+++ b/${filePath}\n`;
  }

  const context = options.context ?? 2;
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);

  // Simple whole-snippet replacement hunk (patch units are already small contexts)
  const oldStart = 1;
  const newStart = 1;
  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${beforeLines.length} +${newStart},${afterLines.length} @@`,
  ];

  // Leading context padding is not needed for snippet-sized patches; emit full hunk.
  void context;
  for (const line of beforeLines) lines.push(`-${line}`);
  for (const line of afterLines) lines.push(`+${line}`);
  return lines.join("\n") + "\n";
}

/** Apply `before` → `after` replacements inside a document. */
export function applyPatchesToContent(
  content: string,
  patches: FixPatch[],
): { content: string; applied: FixPatch[]; skipped: FixPatch[] } {
  let next = content;
  const applied: FixPatch[] = [];
  const skipped: FixPatch[] = [];

  for (const patch of patches) {
    if (!next.includes(patch.before)) {
      skipped.push(patch);
      continue;
    }
    next = next.replace(patch.before, patch.after);
    applied.push(patch);
  }

  return { content: next, applied, skipped };
}

export async function applyDocPatches(options: {
  root: string;
  patches: FixPatch[];
  dryRun?: boolean;
}): Promise<ApplyPatchesResult> {
  const dryRun = options.dryRun ?? true;
  const byPath = new Map<string, FixPatch[]>();
  for (const patch of options.patches) {
    if (!byPath.has(patch.path)) byPath.set(patch.path, []);
    byPath.get(patch.path)!.push(patch);
  }

  const files: UnifiedDiffFile[] = [];
  const written: string[] = [];

  for (const [relPath, patches] of byPath) {
    const abs = path.resolve(options.root, relPath);
    let original: string;
    try {
      original = await fs.readFile(abs, "utf8");
    } catch {
      files.push({
        path: relPath,
        diff: `--- a/${relPath}\n+++ b/${relPath}\n@@ file missing; skipped @@\n`,
        applied: false,
      });
      continue;
    }

    const { content: updated, applied } = applyPatchesToContent(original, patches);
    const diff = toUnifiedDiff(relPath, original, updated);
    const didApply = applied.length > 0 && updated !== original;
    files.push({ path: relPath, diff, applied: didApply });

    if (!dryRun && didApply) {
      await fs.writeFile(abs, updated, "utf8");
      written.push(relPath);
    }
  }

  return { dryRun, files, written };
}
