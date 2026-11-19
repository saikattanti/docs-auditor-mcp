import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPatchesToContent,
  toUnifiedDiff,
} from "./patch.js";

describe("toUnifiedDiff", () => {
  it("emits a unified diff hunk", () => {
    const diff = toUnifiedDiff(
      "README.md",
      "npm run start:dev",
      "npm run dev",
    );
    assert.match(diff, /^--- a\/README\.md/m);
    assert.match(diff, /^\+\+\+ b\/README\.md/m);
    assert.match(diff, /^-npm run start:dev/m);
    assert.match(diff, /^\+npm run dev/m);
  });
});

describe("applyPatchesToContent", () => {
  it("applies matching before/after patches", () => {
    const { content, applied, skipped } = applyPatchesToContent(
      "```bash\nnpm run start:dev\n```",
      [
        {
          path: "README.md",
          rationale: "script rename",
          before: "npm run start:dev",
          after: "npm run dev",
        },
      ],
    );
    assert.equal(applied.length, 1);
    assert.equal(skipped.length, 0);
    assert.match(content, /npm run dev/);
  });

  it("skips patches whose before text is missing", () => {
    const { applied, skipped } = applyPatchesToContent("hello", [
      {
        path: "README.md",
        rationale: "x",
        before: "missing",
        after: "y",
      },
    ]);
    assert.equal(applied.length, 0);
    assert.equal(skipped.length, 1);
  });
});
