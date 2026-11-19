# Docs Audit Report

- **Target:** `fixtures/drifted-sdk`
- **Source:** local
- **Generated:** 2026-11-19T10:04:33.539Z
- **Score:** 7 findings (1 critical, 5 high, 1 medium, 0 low)
- **Docs read:** README.md
- **Snippets checked:** 4

## Execution trace

| Step | Tool | Duration | Summary |
| --- | --- | ---: | --- |
| 1. Fetch repo structure | `fetch_repo_structure` | 8ms | 5 files (local) |
| 2. Read documentation | `read_docs` | 1ms | 1 doc file(s), 893 bytes |
| 3. Cross-check snippets vs code | `cross_check_snippets` | 7ms | 4 snippet(s), 5 finding(s) |
| 4. Check prose path references | `cross_check_snippets` | 0ms | 1 prose finding(s) |
| 5. Check environment variable drift | `check_env_drift` | 9ms | 1 env finding(s) |
| 6. Analyze open docs-related issues | `analyze_open_issues` | 0ms | Skipped (local path; pass --github to enable) |
| 7. Generate fix patches | `generate_fix_patch` | 1ms | 3 proposed patch(es) |

## Findings

### path-1 · HIGH · Documented path not found: src/api/createUser.ts

Snippet in README.md:15 references `src/api/createUser.ts`, but that file is not in the repo tree.

- **Doc:** `README.md`:15
- **Related:** `src/index.js`
- **Fix:** Likely replacement: `src/index.js` (exports `createClient`). Update the docs path or add the missing file.

### import-2 · HIGH · Import path does not resolve: ./src/api/createUser.ts

Code fence at README.md:15 imports `./src/api/createUser.ts`, which does not match any file in the repository.

- **Doc:** `README.md`:15
- **Related:** `src/index.js`
- **Fix:** Replace import of `createUser` from `./src/api/createUser.ts` with `{ createClient }` from `./src/index.js`.

### cmd-3 · CRITICAL · npm script "start:dev" does not exist

Docs tell developers to run `start:dev`, but package.json scripts are: dev, build, test.

- **Doc:** `README.md`:28
- **Fix:** Replace `start:dev` with `dev` (closest match in package.json).

### path-4 · HIGH · Documented path not found: src/webhooks.js

Snippet in README.md:40 references `src/webhooks.js`, but that file is not in the repo tree.

- **Doc:** `README.md`:40
- **Related:** `src/index.js`
- **Fix:** Likely replacement: `src/index.js` (exports `verifyWebhook`). Update the docs path or add the missing file.

### import-5 · HIGH · Import path does not resolve: ./src/webhooks.js

Code fence at README.md:40 imports `./src/webhooks.js`, which does not match any file in the repository.

- **Doc:** `README.md`:40
- **Related:** `src/index.js`
- **Fix:** Replace import of `verifyWebhook` from `./src/webhooks.js` with `{ verifyWebhook }` from `./src/index.js`.

### prose-6 · MEDIUM · Referenced file missing: docs/auth.md

README.md mentions `docs/auth.md` in prose, but the file is not in the repo.

- **Doc:** `README.md`:36
- **Related:** `docs/auth.md`
- **Fix:** Add `docs/auth.md` or remove/replace the reference.

### env-7 · HIGH · Env var ACME_REGION is used in code but undocumented

`ACME_REGION` appears in src/cli.js via `process.env`, but is missing from README/docs and `.env.example`.
- **Related:** `src/cli.js`
- **Fix:** Document `ACME_REGION` in the quickstart and add it to `.env.example`.

## Proposed patches

### Patch 1: `README.md`

Import path does not resolve: ./src/api/createUser.ts

```diff
# before
- ```ts
- import { createUser } from "./src/api/createUser.ts";
- 
# after
+ ```ts
+ import { createClient } from "./src/index.js";
+ 
```

### Patch 2: `README.md`

npm script "start:dev" does not exist

```diff
# before
- ```bash
- npm run start:dev
- ```
# after
+ ```bash
+ npm run dev
+ ```
```

### Patch 3: `README.md`

Import path does not resolve: ./src/webhooks.js

```diff
# before
- ```js
- import { verifyWebhook } from "./src/webhooks.js";
- 
# after
+ ```js
+ import { verifyWebhook } from "./src/index.js";
+ 
```
