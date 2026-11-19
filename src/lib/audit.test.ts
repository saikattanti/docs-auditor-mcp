import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runFullAudit } from "./audit.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/drifted-sdk",
);

describe("runFullAudit on drifted fixture", () => {
  it("detects broken script, missing files, and bad import", async () => {
    const report = await runFullAudit({ path: root });
    assert.ok(report.snippetsChecked >= 3);
    assert.ok(report.score.total >= 3);

    const titles = report.findings.map((f) => f.title).join("\n");
    assert.match(titles, /start:dev/);
    assert.match(titles, /createUser|createUser\.ts|src\/api\/createUser/i);
    assert.ok(report.trace.length >= 5);
    assert.ok(report.trace.every((t) => typeof t.durationMs === "number"));
  });

  it("suggests real exports and produces actionable patches", async () => {
    const report = await runFullAudit({ path: root });
    const createUserFinding = report.findings.find(
      (f) =>
        f.title.includes("Import path does not resolve") &&
        /createUser/i.test(f.detail),
    );
    assert.ok(createUserFinding, "expected a createUser import finding");
    assert.match(createUserFinding.suggestion, /createClient/);
    assert.match(createUserFinding.suggestion, /src\/index\.js/);

    const scriptPatch = report.patches.find(
      (p) => p.before.includes("start:dev") || p.after.includes("npm run dev"),
    );
    assert.ok(scriptPatch, "expected a start:dev → dev patch");

    const importPatch = report.patches.find(
      (p) =>
        p.before.includes("createUser") && p.after.includes("createClient"),
    );
    assert.ok(importPatch, "expected a createUser → createClient patch");
  });

  it("detects undocumented env vars under src/", async () => {
    const report = await runFullAudit({ path: root });
    const envFinding = report.findings.find((f) => f.category === "env_drift");
    assert.ok(envFinding, "expected env drift finding for ACME_REGION");
    assert.match(envFinding.title, /ACME_REGION/);
  });
});
