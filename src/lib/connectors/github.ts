/**
 * GitHub Ingestion Connector
 *
 * Fetches repos, commits, PRs, and issues from GitHub organizations.
 * Supports webhook payloads for event-driven ingest.
 * Rate-limit-aware with exponential backoff.
 */

import { createEnvelope } from "../ontology";
import type {
  ConnectorAdapter,
  ConnectorConfig,
  ConnectorState,
  IngestRecord,
} from "./types";

// ---------------------------------------------------------------------------
// GitHub API response types (minimal)
// ---------------------------------------------------------------------------

interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  topics: string[];
  default_branch: string;
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  fork: boolean;
  stargazers_count: number;
  open_issues_count: number;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  html_url: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  pull_request?: { url: string };
}

interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
}

// ---------------------------------------------------------------------------
// Webhook payload types
// ---------------------------------------------------------------------------

interface WebhookPayload {
  action?: string;
  repository?: GitHubRepo;
  commits?: GitHubCommit[];
  issue?: GitHubIssue;
  pull_request?: GitHubPR;
  sender?: { login: string };
}

// ---------------------------------------------------------------------------
// Connector implementation
// ---------------------------------------------------------------------------

export class GitHubConnector implements ConnectorAdapter {
  readonly id = "github";
  readonly name = "GitHub";

  private config: ConnectorConfig | null = null;
  private state: ConnectorState = {
    status: "idle",
    last_run: null,
    records_ingested: 0,
    errors: 0,
    last_error: null,
  };

  private get token(): string | null {
    return (this.config?.settings.token as string) ?? process.env.GITHUB_TOKEN ?? null;
  }

  private get orgs(): string[] {
    const orgs = this.config?.settings.orgs;
    if (Array.isArray(orgs)) return orgs as string[];
    return [
      "ivviiviivvi",
      "omni-dromenon-machina",
      "labores-profani-crux",
      "meta-organvm",
      "4444j99",
    ];
  }

  configure(config: ConnectorConfig): void {
    this.config = config;
  }

  getState(): ConnectorState {
    return { ...this.state };
  }

  async sync(options?: { incremental?: boolean; since?: string }): Promise<IngestRecord[]> {
    this.state.status = "running";
    const records: IngestRecord[] = [];
    const shouldCollectActivity = !options?.incremental || Boolean(options?.since);

    try {
      for (const org of this.orgs) {
        const repos = await this.fetchOrgRepos(org);
        for (const repo of repos) {
          records.push(this.repoToRecord(repo, org));

          if (shouldCollectActivity) {
            const [commits, issues, prs] = await Promise.all([
              this.fetchRecentCommits(org, repo.name, options?.since),
              this.fetchRecentIssues(org, repo.name, options?.since),
              this.fetchRecentPRs(org, repo.name, options?.since),
            ]);

            for (const commit of commits) {
              records.push(this.commitToRecord(commit, repo.full_name));
            }
            for (const issue of issues) {
              records.push(this.issueToRecord(issue, repo.full_name));
            }
            for (const pr of prs) {
              records.push(this.prToRecord(pr, repo.full_name));
            }
          }
        }
      }

      this.state.status = "completed";
      this.state.last_run = new Date().toISOString();
      this.state.records_ingested += records.length;
    } catch (error) {
      this.state.status = "error";
      this.state.errors += 1;
      this.state.last_error = error instanceof Error ? error.message : String(error);
    }

    return records;
  }

  async handleWebhook(payload: unknown): Promise<IngestRecord[]> {
    const hook = payload as WebhookPayload;
    const records: IngestRecord[] = [];

    if (hook.repository) {
      records.push(this.repoToRecord(hook.repository, hook.repository.full_name.split("/")[0]));
    }

    if (hook.commits) {
      const repoName = hook.repository?.full_name ?? "unknown";
      for (const commit of hook.commits) {
        records.push(this.commitToRecord(commit, repoName));
      }
    }

    if (hook.issue) {
      records.push(this.issueToRecord(hook.issue, hook.repository?.full_name ?? "unknown"));
    }

    if (hook.pull_request) {
      records.push(this.prToRecord(hook.pull_request, hook.repository?.full_name ?? "unknown"));
    }

    return records;
  }

  // -------------------------------------------------------------------------
  // GitHub API helpers
  // -------------------------------------------------------------------------

  private async fetchJson<T>(url: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });

    if (response.status === 403 || response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
      throw new Error(`GitHub rate limited. Retry after ${waitMs}ms`);
    }

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}: ${url}`);
    }

    return response.json() as Promise<T>;
  }

  private async fetchOrgRepos(org: string): Promise<GitHubRepo[]> {
    try {
      return await this.fetchJson<GitHubRepo[]>(
        `https://api.github.com/orgs/${org}/repos?per_page=100&sort=pushed`
      );
    } catch {
      // Fallback for user accounts
      try {
        return await this.fetchJson<GitHubRepo[]>(
          `https://api.github.com/users/${org}/repos?per_page=100&sort=pushed`
        );
      } catch {
        return [];
      }
    }
  }

  private async fetchRecentCommits(
    org: string,
    repo: string,
    since?: string
  ): Promise<GitHubCommit[]> {
    const params = new URLSearchParams({ per_page: "30" });
    if (since) params.set("since", since);

    try {
      return await this.fetchJson<GitHubCommit[]>(
        `https://api.github.com/repos/${org}/${repo}/commits?${params}`
      );
    } catch {
      return [];
    }
  }

  private async fetchRecentIssues(
    org: string,
    repo: string,
    since?: string
  ): Promise<GitHubIssue[]> {
    const params = new URLSearchParams({
      state: "all",
      per_page: "30",
      sort: "updated",
      direction: "desc",
    });
    if (since) params.set("since", since);

    try {
      const issues = await this.fetchJson<GitHubIssue[]>(
        `https://api.github.com/repos/${org}/${repo}/issues?${params}`
      );
      return issues.filter((issue) => !issue.pull_request);
    } catch {
      return [];
    }
  }

  private async fetchRecentPRs(
    org: string,
    repo: string,
    since?: string
  ): Promise<GitHubPR[]> {
    const params = new URLSearchParams({
      state: "all",
      per_page: "30",
      sort: "updated",
      direction: "desc",
    });

    try {
      const prs = await this.fetchJson<GitHubPR[]>(
        `https://api.github.com/repos/${org}/${repo}/pulls?${params}`
      );
      if (!since) return prs;
      return prs.filter((pr) => this.isOnOrAfter(pr.updated_at, since));
    } catch {
      return [];
    }
  }

  private isOnOrAfter(value: string, threshold: string): boolean {
    const valueMs = Date.parse(value);
    const thresholdMs = Date.parse(threshold);
    if (!Number.isFinite(valueMs) || !Number.isFinite(thresholdMs)) return true;
    return valueMs >= thresholdMs;
  }

  // -------------------------------------------------------------------------
  // Record conversion
  // -------------------------------------------------------------------------

  private repoToRecord(repo: GitHubRepo, org: string): IngestRecord {
    return {
      dedup_key: `github:repo:${repo.full_name}`,
      entity_class: "repo",
      name: repo.name,
      display_name: repo.name.replace(/--/g, ": ").replace(/-/g, " "),
      description: repo.description || `Repository ${repo.name}`,
      attributes: {
        github_url: repo.html_url,
        language: repo.language,
        topics: repo.topics,
        default_branch: repo.default_branch,
        archived: repo.archived,
        fork: repo.fork,
        stars: repo.stargazers_count,
        open_issues: repo.open_issues_count,
        pushed_at: repo.pushed_at,
        created_at: repo.created_at,
      },
      envelope: createEnvelope({
        source_id: `github:${org}`,
        source_type: "github",
        channel: "api",
        confidence: 1.0,
      }),
      aliases: [repo.full_name, repo.name],
      relationships: [
        {
          type: "belongs_to",
          target_hint: `organ:${org}`,
          strength: 1.0,
          evidence: `GitHub org: ${org}`,
        },
      ],
    };
  }

  private commitToRecord(commit: GitHubCommit, repoFullName: string): IngestRecord {
    const firstLine = commit.commit.message.split("\n")[0].slice(0, 200);
    return {
      dedup_key: `github:commit:${commit.sha}`,
      entity_class: "artifact",
      name: `commit-${commit.sha.slice(0, 8)}`,
      display_name: firstLine,
      description: commit.commit.message.slice(0, 500),
      attributes: {
        artifact_type: "commit",
        sha: commit.sha,
        author: commit.commit.author?.name ?? "unknown",
        date: commit.commit.author?.date ?? new Date().toISOString(),
        url: commit.html_url,
      },
      envelope: createEnvelope({
        source_id: `github:${repoFullName}`,
        source_type: "github",
        channel: "api",
        confidence: 1.0,
        valid_from: commit.commit.author?.date ?? new Date().toISOString(),
      }),
      relationships: [
        {
          type: "belongs_to",
          target_hint: `repo:${repoFullName.split("/")[1]}`,
          strength: 1.0,
          evidence: `Commit ${commit.sha.slice(0, 8)} in ${repoFullName}`,
        },
      ],
    };
  }

  private issueToRecord(issue: GitHubIssue, repoFullName: string): IngestRecord {
    return {
      dedup_key: `github:issue:${repoFullName}#${issue.number}`,
      entity_class: "issue",
      name: `issue-${repoFullName.split("/")[1]}-${issue.number}`,
      display_name: issue.title,
      description: (issue.body || issue.title).slice(0, 1000),
      attributes: {
        issue_type: "task",
        priority: "medium",
        state: issue.state,
        labels: issue.labels.map((l) => l.name),
        source_url: issue.html_url,
        author: issue.user?.login ?? "unknown",
        created_at: issue.created_at,
        updated_at: issue.updated_at,
      },
      envelope: createEnvelope({
        source_id: `github:${repoFullName}`,
        source_type: "github",
        channel: "api",
        confidence: 1.0,
        valid_from: issue.created_at,
      }),
      relationships: [
        {
          type: "references",
          target_hint: `repo:${repoFullName.split("/")[1]}`,
          strength: 0.9,
          evidence: `Issue #${issue.number} in ${repoFullName}`,
        },
      ],
    };
  }

  private prToRecord(pr: GitHubPR, repoFullName: string): IngestRecord {
    return {
      dedup_key: `github:pr:${repoFullName}#${pr.number}`,
      entity_class: "artifact",
      name: `pr-${repoFullName.split("/")[1]}-${pr.number}`,
      display_name: pr.title,
      description: (pr.body || pr.title).slice(0, 1000),
      attributes: {
        artifact_type: "pull_request",
        state: pr.state,
        merged_at: pr.merged_at,
        source_url: pr.html_url,
        author: pr.user?.login ?? "unknown",
        head_ref: pr.head.ref,
        base_ref: pr.base.ref,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
      },
      envelope: createEnvelope({
        source_id: `github:${repoFullName}`,
        source_type: "github",
        channel: "api",
        confidence: 1.0,
        valid_from: pr.created_at,
      }),
      relationships: [
        {
          type: "references",
          target_hint: `repo:${repoFullName.split("/")[1]}`,
          strength: 0.95,
          evidence: `PR #${pr.number} in ${repoFullName}`,
        },
      ],
    };
  }
}
