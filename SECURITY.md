# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email **[saikattanti2005@gmail.com](mailto:saikattanti2005@gmail.com)** with:

1. A short description of the issue
2. Steps to reproduce (or a proof of concept)
3. Affected version / commit if known
4. Any idea of impact (data exposure, RCE, token leakage, etc.)

You should receive an acknowledgment within **7 days**. After that we will
investigate, fix, and coordinate disclosure.

## Scope notes

This project:

- Reads local files and/or public GitHub API content that you point it at
- Does **not** require an LLM API key for audits
- May use an optional `GITHUB_TOKEN` for higher GitHub API rate limits

Please report issues such as:

- Unexpected file reads outside the intended audit target
- Unsafe handling of untrusted markdown/snippets that could lead to command injection if wired into automation
- Credential leakage through logs or reports
- Dependency vulnerabilities with a practical exploit path in this project

## Safe contribution practice

- Never commit real tokens or `.env` files
- Prefer `GITHUB_TOKEN` via environment variables
- Treat audit targets and generated reports as potentially sensitive when run against private repos
