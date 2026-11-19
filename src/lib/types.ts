export type Severity = "critical" | "high" | "medium" | "low";

export interface RepoFile {
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface RepoStructure {
  root: string;
  source: "local" | "github";
  files: RepoFile[];
  totalFiles: number;
  truncated: boolean;
}

export interface DocFile {
  path: string;
  content: string;
  bytes: number;
}

export interface CodeSnippet {
  docPath: string;
  language: string;
  code: string;
  startLine: number;
  endLine: number;
  /** Heuristic: looks like a shell command block */
  kind: "shell" | "code" | "json" | "unknown";
}

export interface Finding {
  id: string;
  severity: Severity;
  category:
    | "missing_file"
    | "missing_export"
    | "broken_command"
    | "docs_gap"
    | "stale_snippet"
    | "missing_doc"
    | "env_drift"
    | "arity_mismatch";
  title: string;
  detail: string;
  docPath?: string;
  docLine?: number;
  relatedPath?: string;
  suggestion: string;
}

export interface ExportedSymbol {
  name: string;
  kind: "function" | "class" | "const" | "type" | "unknown";
  /** Total parameter count (including optional / defaulted). */
  paramCount: number;
  /** Parameters without defaults or `?`. */
  requiredParamCount: number;
  signature: string;
}

export interface SlimAuditReport {
  target: string;
  source: "local" | "github";
  generatedAt: string;
  score: AuditReport["score"];
  snippetsChecked: number;
  docs: string[];
  findings: Finding[];
  patches: FixPatch[];
  trace: AuditStepTrace[];
}

export interface SnippetCheckResult {
  snippet: CodeSnippet;
  findings: Finding[];
}

export interface FixPatch {
  path: string;
  rationale: string;
  before: string;
  after: string;
}

export interface AuditStepTrace {
  step: string;
  tool: string;
  startedAt: string;
  durationMs: number;
  summary: string;
}

export interface AuditReport {
  target: string;
  source: "local" | "github";
  generatedAt: string;
  structure: RepoStructure;
  docs: DocFile[];
  snippetsChecked: number;
  findings: Finding[];
  patches: FixPatch[];
  trace: AuditStepTrace[];
  score: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
}
