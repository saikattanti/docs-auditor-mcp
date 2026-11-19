import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  checkEnvVarDrift,
  extractEnvVarsFromSource,
  parseEnvExample,
} from "./env-drift.js";
import { fetchLocalRepoStructure, readLocalDocs } from "./fs-repo.js";
import { resetFindingIds } from "./ids.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/drifted-sdk",
);

describe("extractEnvVarsFromSource", () => {
  it("finds process.env.NAME and bracket access", () => {
    const names = extractEnvVarsFromSource(`
      const a = process.env.ACME_API_KEY;
      const b = process.env["ACME_REGION"];
    `);
    assert.deepEqual(names.sort(), ["ACME_API_KEY", "ACME_REGION"]);
  });
});

describe("parseEnvExample", () => {
  it("parses KEY=value lines and ignores comments", () => {
    const set = parseEnvExample(`# hi\nACME_API_KEY=\nFOO_BAR=1\n`);
    assert.ok(set.has("ACME_API_KEY"));
    assert.ok(set.has("FOO_BAR"));
  });
});

describe("checkEnvVarDrift", () => {
  it("flags ACME_REGION used in fixture src but missing from docs/.env.example", async () => {
    resetFindingIds();
    const structure = await fetchLocalRepoStructure(fixtureRoot);
    const docs = await readLocalDocs(fixtureRoot, structure);
    const findings = await checkEnvVarDrift(docs, structure);
    const region = findings.find((f) => /ACME_REGION/.test(f.title));
    assert.ok(region, "expected ACME_REGION env drift finding");
    assert.equal(region.category, "env_drift");
    assert.equal(region.severity, "high");
  });
});
