import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countParams,
  findCallSites,
  parseExportedSymbols,
} from "./signatures.js";

describe("parseExportedSymbols", () => {
  it("parses function arity including optional defaults", () => {
    const symbols = parseExportedSymbols(`
      export function createClient(options = {}) {}
      export function verifyWebhook(payload, secret) {}
    `);
    const createClient = symbols.find((s) => s.name === "createClient");
    const verify = symbols.find((s) => s.name === "verifyWebhook");
    assert.ok(createClient);
    assert.equal(createClient.paramCount, 1);
    assert.equal(createClient.requiredParamCount, 0);
    assert.ok(verify);
    assert.equal(verify.paramCount, 2);
    assert.equal(verify.requiredParamCount, 2);
  });
});

describe("findCallSites", () => {
  it("counts call arguments", () => {
    const sites = findCallSites(`
      const user = createUser({ apiKey: "x" });
      verifyWebhook(req.body, secret);
    `);
    const createUser = sites.find((s) => s.name === "createUser");
    const verify = sites.find((s) => s.name === "verifyWebhook");
    assert.equal(createUser?.argCount, 1);
    assert.equal(verify?.argCount, 2);
  });
});

describe("countParams", () => {
  it("handles empty and nested params", () => {
    assert.deepEqual(countParams(""), { paramCount: 0, requiredParamCount: 0 });
    assert.equal(countParams("a, b = 1").paramCount, 2);
    assert.equal(countParams("a, b = 1").requiredParamCount, 1);
  });
});
