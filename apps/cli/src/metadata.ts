import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

export function collectGitMetadata(cwd: string): Record<string, string | boolean | null> {
  const repoRoot = git(["rev-parse", "--show-toplevel"], cwd);
  const parsedRemote = parseRemote(git(["config", "--get", "remote.origin.url"], cwd));
  const status = git(["status", "--porcelain"], cwd);

  return {
    repoOrg: parsedRemote.org || inferOrgFromRoot(repoRoot),
    repoName: parsedRemote.name || (repoRoot ? path.basename(repoRoot) : null),
    repoHost: parsedRemote.host || null,
    gitBranch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    gitCommitSha: git(["rev-parse", "HEAD"], cwd),
    gitCommitSubject: git(["log", "-1", "--format=%s"], cwd),
    // null when not a git repo; true/false when a working tree is present.
    gitDirty: status === null ? null : status.length > 0,
  };
}

// Best-effort CI provenance. GitHub Actions is detected precisely (with a run
// URL); other CI systems are flagged generically. Nothing here is trusted for
// authorization — it is metadata for the dashboard and audit trail only.
export function collectCiMetadata(): Record<string, string | null> {
  const env = process.env;
  if (env.GITHUB_ACTIONS === "true") {
    const server = env.GITHUB_SERVER_URL || "https://github.com";
    const repo = env.GITHUB_REPOSITORY;
    const runId = env.GITHUB_RUN_ID;
    return {
      ciProvider: "github_actions",
      ciRunUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null,
      ciActor: env.GITHUB_ACTOR || null,
    };
  }
  if (env.CI) {
    return { ciProvider: "unknown" };
  }
  return {};
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function parseRemote(remote: string | null): { host?: string; org?: string; name?: string } {
  if (!remote) return {};

  const cleaned = remote.replace(/\.git$/, "");
  const [, sshHost, sshOrg, sshName] = cleaned.match(/^[^@]+@([^:]+):([^/]+)\/(.+)$/) ?? [];
  if (sshHost && sshOrg && sshName) {
    return { host: sshHost, org: sshOrg, name: path.basename(sshName) };
  }

  try {
    const url = new URL(cleaned);
    const [org, ...rest] = url.pathname.split("/").filter(Boolean);
    const name = rest.at(-1);
    if (org && name) {
      return { host: url.hostname, org, name };
    }
  } catch {
    // Fall through to path parsing.
  }

  const [org, name] = cleaned.split("/").filter(Boolean).slice(-2);
  if (org && name) {
    return { org, name };
  }

  return {};
}

function inferOrgFromRoot(repoRoot: string | null): string | null {
  if (!repoRoot) return null;
  return path.basename(path.dirname(repoRoot));
}
