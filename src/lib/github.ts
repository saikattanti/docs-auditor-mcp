import type { DocFile, RepoFile, RepoStructure } from "./types.js";

const GITHUB_API = "https://api.github.com";

export interface GitHubTarget {
  owner: string;
  repo: string;
  ref?: string;
}

export function parseGitHubRepo(input: string): GitHubTarget {
  const trimmed = input.trim().replace(/\/$/, "");

  // owner/repo
  const short = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) {
    return { owner: short[1], repo: short[2] };
  }

  // https://github.com/owner/repo[/tree/ref]
  const url = trimmed.match(
    /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/#?]+))?/i,
  );
  if (url) {
    return { owner: url[1], repo: url[2], ref: url[3] };
  }

  throw new Error(
    `Could not parse GitHub repo from "${input}". Use owner/repo or a github.com URL.`,
  );
}

async function githubFetch(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "docs-auditor-mcp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (auth) headers.Authorization = `Bearer ${auth}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub API ${res.status} for ${url}: ${body.slice(0, 300)}`,
    );
  }
  return res;
}

export async function fetchGitHubRepoStructure(
  target: GitHubTarget,
  options: { maxFiles?: number; token?: string } = {},
): Promise<RepoStructure> {
  const maxFiles = options.maxFiles ?? 2000;

  // Recursive tree via default branch tip
  let treeSha: string;
  if (target.ref) {
    const refRes = await githubFetch(
      `${GITHUB_API}/repos/${target.owner}/${target.repo}/git/ref/heads/${target.ref}`,
      options.token,
    ).catch(async () =>
      githubFetch(
        `${GITHUB_API}/repos/${target.owner}/${target.repo}/commits/${target.ref}`,
        options.token,
      ),
    );
    const refJson = (await refRes.json()) as {
      object?: { sha: string };
      sha?: string;
    };
    treeSha = refJson.object?.sha ?? refJson.sha ?? "";
    if (!treeSha) throw new Error("Could not resolve GitHub ref SHA");
  } else {
    const repoRes = await githubFetch(
      `${GITHUB_API}/repos/${target.owner}/${target.repo}`,
      options.token,
    );
    const repoJson = (await repoRes.json()) as {
      default_branch: string;
    };
    const branchRes = await githubFetch(
      `${GITHUB_API}/repos/${target.owner}/${target.repo}/git/ref/heads/${repoJson.default_branch}`,
      options.token,
    );
    const branchJson = (await branchRes.json()) as {
      object: { sha: string };
    };
    treeSha = branchJson.object.sha;
  }

  const commitRes = await githubFetch(
    `${GITHUB_API}/repos/${target.owner}/${target.repo}/git/commits/${treeSha}`,
    options.token,
  );
  const commitJson = (await commitRes.json()) as {
    tree: { sha: string };
  };

  const treeRes = await githubFetch(
    `${GITHUB_API}/repos/${target.owner}/${target.repo}/git/trees/${commitJson.tree.sha}?recursive=1`,
    options.token,
  );
  const treeJson = (await treeRes.json()) as {
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated: boolean;
  };

  const files: RepoFile[] = [];
  for (const item of treeJson.tree) {
    if (item.type === "blob") {
      files.push({ path: item.path, type: "file", size: item.size });
    } else if (item.type === "tree") {
      files.push({ path: item.path + "/", type: "dir" });
    }
    if (files.filter((f) => f.type === "file").length >= maxFiles) break;
  }

  const fileOnly = files.filter((f) => f.type === "file");
  return {
    root: `github://${target.owner}/${target.repo}${target.ref ? `@${target.ref}` : ""}`,
    source: "github",
    files,
    totalFiles: fileOnly.length,
    truncated: treeJson.truncated || fileOnly.length >= maxFiles,
  };
}

export async function readGitHubDocs(
  target: GitHubTarget,
  structure: RepoStructure,
  options: { token?: string; maxDocs?: number } = {},
): Promise<DocFile[]> {
  const maxDocs = options.maxDocs ?? 12;
  const candidates = structure.files
    .filter((f) => f.type === "file")
    .map((f) => f.path)
    .filter((p) => {
      const lower = p.toLowerCase();
      const base = lower.split("/").pop() ?? "";
      return (
        base === "readme.md" ||
        base === "contributing.md" ||
        base === "changelog.md" ||
        base === "quickstart.md" ||
        lower.startsWith("docs/") ||
        lower.includes("/docs/")
      );
    })
    .filter((p) => /\.(md|mdx)$/i.test(p))
    .slice(0, maxDocs);

  candidates.sort((a, b) => {
    const score = (p: string) =>
      p.toLowerCase().endsWith("readme.md") && !p.includes("/") ? 0 : 1;
    return score(a) - score(b) || a.localeCompare(b);
  });

  const docs: DocFile[] = [];
  for (const rel of candidates) {
    const refPart = target.ref ? `?ref=${encodeURIComponent(target.ref)}` : "";
    const res = await githubFetch(
      `${GITHUB_API}/repos/${target.owner}/${target.repo}/contents/${rel}${refPart}`,
      options.token,
    );
    const json = (await res.json()) as {
      content?: string;
      encoding?: string;
      size?: number;
    };
    if (!json.content || json.encoding !== "base64") continue;
    const content = Buffer.from(json.content, "base64").toString("utf8");
    docs.push({
      path: rel,
      content,
      bytes: json.size ?? Buffer.byteLength(content, "utf8"),
    });
  }
  return docs;
}

export async function fetchGitHubFileText(
  target: GitHubTarget,
  relPath: string,
  token?: string,
): Promise<string | null> {
  const refPart = target.ref ? `?ref=${encodeURIComponent(target.ref)}` : "";
  try {
    const res = await githubFetch(
      `${GITHUB_API}/repos/${target.owner}/${target.repo}/contents/${relPath}${refPart}`,
      token,
    );
    const json = (await res.json()) as {
      content?: string;
      encoding?: string;
    };
    if (!json.content || json.encoding !== "base64") return null;
    return Buffer.from(json.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export async function analyzeGitHubDocIssues(
  target: GitHubTarget,
  token?: string,
): Promise<
  Array<{ number: number; title: string; labels: string[]; url: string }>
> {
  const q = encodeURIComponent(
    `repo:${target.owner}/${target.repo} is:issue is:open (docs OR documentation OR readme OR quickstart)`,
  );
  try {
    const res = await githubFetch(
      `${GITHUB_API}/search/issues?q=${q}&per_page=10`,
      token,
    );
    const json = (await res.json()) as {
      items: Array<{
        number: number;
        title: string;
        html_url: string;
        labels: Array<{ name: string }>;
      }>;
    };
    return json.items.map((i) => ({
      number: i.number,
      title: i.title,
      labels: i.labels.map((l) => l.name),
      url: i.html_url,
    }));
  } catch {
    return [];
  }
}
