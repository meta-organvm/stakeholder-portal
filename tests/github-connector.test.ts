import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubConnector } from "@/lib/connectors/github";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHubConnector", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("sync ingests repo, commit, issue, and PR records", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/orgs/acme/repos")) {
        return jsonResponse([
          {
            name: "portal",
            full_name: "acme/portal",
            description: "Portal",
            html_url: "https://github.com/acme/portal",
            language: "TypeScript",
            topics: ["portal"],
            default_branch: "main",
            pushed_at: "2026-03-01T00:00:00.000Z",
            created_at: "2025-01-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
            archived: false,
            fork: false,
            stargazers_count: 10,
            open_issues_count: 3,
          },
        ]);
      }
      if (url.includes("/repos/acme/portal/commits")) {
        return jsonResponse([
          {
            sha: "abc1234567890",
            commit: {
              message: "feat: add portal",
              author: { name: "dev", date: "2026-03-01T00:00:00.000Z" },
            },
            html_url: "https://github.com/acme/portal/commit/abc1234",
          },
        ]);
      }
      if (url.includes("/repos/acme/portal/issues")) {
        return jsonResponse([
          {
            number: 11,
            title: "Bug report",
            body: "fix me",
            state: "open",
            html_url: "https://github.com/acme/portal/issues/11",
            labels: [{ name: "bug" }],
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
            user: { login: "alice" },
          },
          {
            number: 12,
            title: "PR mirror entry",
            body: null,
            state: "open",
            html_url: "https://github.com/acme/portal/issues/12",
            labels: [],
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
            user: { login: "alice" },
            pull_request: { url: "https://api.github.com/repos/acme/portal/pulls/12" },
          },
        ]);
      }
      if (url.includes("/repos/acme/portal/pulls")) {
        return jsonResponse([
          {
            number: 12,
            title: "Feature PR",
            body: "implements feature",
            state: "open",
            html_url: "https://github.com/acme/portal/pull/12",
            merged_at: null,
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
            user: { login: "bob" },
            head: { ref: "feature" },
            base: { ref: "main" },
          },
        ]);
      }
      return jsonResponse({ message: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const connector = new GitHubConnector();
    connector.configure({
      id: "github",
      name: "GitHub",
      enabled: true,
      settings: { orgs: ["acme"] },
    });

    const records = await connector.sync();
    expect(records).toHaveLength(4);
    expect(records.some((r) => r.dedup_key === "github:repo:acme/portal")).toBe(true);
    expect(records.some((r) => r.dedup_key === "github:commit:abc1234567890")).toBe(true);
    expect(records.some((r) => r.dedup_key === "github:issue:acme/portal#11")).toBe(true);
    expect(records.some((r) => r.dedup_key === "github:pr:acme/portal#12")).toBe(true);
  });

  it("incremental sync without since only ingests repository records", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/orgs/acme/repos")) {
        return jsonResponse([
          {
            name: "portal",
            full_name: "acme/portal",
            description: "Portal",
            html_url: "https://github.com/acme/portal",
            language: "TypeScript",
            topics: ["portal"],
            default_branch: "main",
            pushed_at: "2026-03-01T00:00:00.000Z",
            created_at: "2025-01-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
            archived: false,
            fork: false,
            stargazers_count: 10,
            open_issues_count: 3,
          },
        ]);
      }
      return jsonResponse([], 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    const connector = new GitHubConnector();
    connector.configure({
      id: "github",
      name: "GitHub",
      enabled: true,
      settings: { orgs: ["acme"] },
    });

    const records = await connector.sync({ incremental: true });
    expect(records).toHaveLength(1);
    expect(records[0].entity_class).toBe("repo");
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("filters PRs by since when incremental sync includes activity", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/orgs/acme/repos")) {
        return jsonResponse([
          {
            name: "portal",
            full_name: "acme/portal",
            description: "Portal",
            html_url: "https://github.com/acme/portal",
            language: "TypeScript",
            topics: ["portal"],
            default_branch: "main",
            pushed_at: "2026-03-01T00:00:00.000Z",
            created_at: "2025-01-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
            archived: false,
            fork: false,
            stargazers_count: 10,
            open_issues_count: 3,
          },
        ]);
      }
      if (url.includes("/repos/acme/portal/commits")) {
        return jsonResponse([]);
      }
      if (url.includes("/repos/acme/portal/issues")) {
        return jsonResponse([]);
      }
      if (url.includes("/repos/acme/portal/pulls")) {
        return jsonResponse([
          {
            number: 1,
            title: "Old PR",
            body: null,
            state: "closed",
            html_url: "https://github.com/acme/portal/pull/1",
            merged_at: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-02T00:00:00.000Z",
            user: { login: "old" },
            head: { ref: "old" },
            base: { ref: "main" },
          },
          {
            number: 2,
            title: "Fresh PR",
            body: null,
            state: "open",
            html_url: "https://github.com/acme/portal/pull/2",
            merged_at: null,
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-02T00:00:00.000Z",
            user: { login: "new" },
            head: { ref: "new" },
            base: { ref: "main" },
          },
        ]);
      }
      return jsonResponse({ message: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const connector = new GitHubConnector();
    connector.configure({
      id: "github",
      name: "GitHub",
      enabled: true,
      settings: { orgs: ["acme"] },
    });

    const records = await connector.sync({
      incremental: true,
      since: "2026-02-15T00:00:00.000Z",
    });

    expect(records.some((r) => r.dedup_key === "github:pr:acme/portal#1")).toBe(false);
    expect(records.some((r) => r.dedup_key === "github:pr:acme/portal#2")).toBe(true);
  });
});
