/** Public MCP capability names — kept here so tests can assert without starting stdio. */
export const MCP_PROMPT_NAMES = ["audit-quickstart", "fix-drift"] as const;

export const MCP_RESOURCE_URIS = ["audit://report/latest"] as const;

export const MCP_TOOL_NAMES = [
  "fetch_repo_structure",
  "read_docs",
  "cross_check_snippets",
  "analyze_open_issues",
  "generate_fix_patch",
  "run_full_audit",
  "apply_doc_patches",
] as const;
