# Contributing to Docs Auditor MCP

Thanks for helping improve a small DevRel-focused MCP server. This project stays
intentionally lean: deterministic docs-drift checks, a CLI, and an MCP tool
surface that agents can call.

## Ground rules

- Be kind. We follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Prefer small, focused pull requests over large mixed changes.
- Prefer clear findings and patches over clever heuristics that are hard to explain.
- Do not commit secrets, tokens, or personal `.env` files.

## Prerequisites

- Node.js **20+**
- npm (comes with Node)
- Optional: a GitHub personal access token (`GITHUB_TOKEN`) for higher rate
  limits when auditing remote repos

## Local setup

```bash
git clone https://github.com/saikattanti/docs-auditor-mcp.git
cd docs-auditor-mcp
npm install
```

Copy `.env.example` to `.env` only if you need a GitHub token:

```bash
cp .env.example .env
# edit .env and set GITHUB_TOKEN=...
```

## Common commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run unit + fixture integration tests |
| `npm run typecheck` | TypeScript check without emitting |
| `npm run build` | Compile to `dist/` |
| `npm run audit:fixture` | Audit the intentional-drift fixture |
| `npm run audit -- --path <dir>` | Audit a local checkout |
| `npm run mcp` | Start the MCP server on stdio |

### Run tests

```bash
npm test
```

All tests should pass before you open a PR.

### Run the fixture demo

```bash
npm run audit:fixture
```

You should see critical/high findings for the broken `start:dev` script, missing
imports, and the missing `docs/auth.md` reference. Exit code `2` for
critical/high findings is expected on the fixture.

### Build

```bash
npm run build
```

## Coding style

- **Language:** TypeScript (ESM, `NodeNext` module resolution)
- **Strictness:** keep `strict` TypeScript; avoid `any` unless unavoidable
- **Formatting:** match nearby files — 2-space indent, no unused locals/params
- **Errors:** throw clear `Error` messages users can act on
- **Tests:** add or update `src/**/*.test.ts` for behavior changes in parsers,
  cross-checks, or the audit pipeline
- **Scope:** keep the auditor deterministic (no LLM calls inside the tool code)

## Project map

```text
src/
  index.ts          MCP server (stdio)
  cli.ts            CLI entry
  lib/              Audit pipeline, parsers, GitHub/local sources
fixtures/           Intentional docs-drift SDK used in demos/tests
examples/           Sample report + Cursor MCP config snippet
```

## Pull request checklist

1. Branch from `main` with a short descriptive name.
2. Make the change and keep the diff focused.
3. Run:

   ```bash
   npm test
   npm run typecheck
   npm run build
   npm run audit:fixture
   ```

4. Update docs (`README.md`, examples, or comments) if behavior or commands change.
5. Open a PR that explains:
   - what problem it solves
   - how you tested it
   - any intentional trade-offs

## Reporting bugs and requesting features

Use the GitHub issue templates:

- Bug report
- Feature request

Security issues are handled separately — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
