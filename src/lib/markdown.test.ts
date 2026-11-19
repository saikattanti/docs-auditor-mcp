import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractNpmScripts,
  extractPathReferences,
  extractSnippets,
} from "./markdown.js";

describe("extractSnippets", () => {
  it("parses fenced blocks with languages and line numbers", () => {
    const docs = [
      {
        path: "README.md",
        bytes: 0,
        content: `# Demo

\`\`\`bash
npm run start:dev
\`\`\`

\`\`\`ts
import { createUser } from "./src/api/createUser.ts";
\`\`\`
`,
      },
    ];
    const snippets = extractSnippets(docs);
    assert.equal(snippets.length, 2);
    assert.equal(snippets[0].kind, "shell");
    assert.equal(snippets[0].startLine, 3);
    assert.equal(snippets[1].language, "ts");
    assert.match(snippets[1].code, /createUser/);
  });
});

describe("extractNpmScripts", () => {
  it("finds npm run script names", () => {
    assert.deepEqual(extractNpmScripts("npm run start:dev && npm test"), [
      "start:dev",
      "test",
    ]);
  });
});

describe("extractPathReferences", () => {
  it("finds backtick file paths", () => {
    const refs = extractPathReferences(
      "See `src/api/createUser.ts` and `docs/auth.md`.",
    );
    assert.ok(refs.includes("src/api/createUser.ts"));
    assert.ok(refs.includes("docs/auth.md"));
  });
});
