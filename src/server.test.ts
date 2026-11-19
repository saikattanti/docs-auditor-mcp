import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
  createDocsAuditorServer,
} from "./server.js";

describe("MCP primitives registration", () => {
  it("exposes expected prompt, resource, and tool names", () => {
    assert.deepEqual([...MCP_PROMPT_NAMES], ["audit-quickstart", "fix-drift"]);
    assert.deepEqual([...MCP_RESOURCE_URIS], ["audit://report/latest"]);
    assert.ok(MCP_TOOL_NAMES.includes("apply_doc_patches"));
    assert.ok(MCP_TOOL_NAMES.includes("run_full_audit"));
  });

  it("creates a server with prompts and resources registered", () => {
    const server = createDocsAuditorServer();
    assert.ok(server);
    // Access private registries through a narrow cast for registration smoke tests
    const internal = server as unknown as {
      _registeredPrompts: Record<string, unknown>;
      _registeredResources: Record<string, unknown>;
      _registeredTools: Record<string, unknown>;
    };
    for (const name of MCP_PROMPT_NAMES) {
      assert.ok(internal._registeredPrompts[name], `missing prompt ${name}`);
    }
    for (const uri of MCP_RESOURCE_URIS) {
      assert.ok(
        internal._registeredResources[uri],
        `missing resource ${uri}`,
      );
    }
    for (const name of MCP_TOOL_NAMES) {
      assert.ok(internal._registeredTools[name], `missing tool ${name}`);
    }
  });
});
