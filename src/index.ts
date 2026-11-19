#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDocsAuditorServer } from "./server.js";

async function main() {
  const server = createDocsAuditorServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio MCP: never use console.log — it corrupts the protocol stream
  console.error("docs-auditor-mcp listening on stdio");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
