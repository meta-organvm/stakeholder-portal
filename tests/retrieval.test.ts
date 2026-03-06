import { describe, expect, it, vi } from "vitest";

// Mock @/lib/manifest so tests are decoupled from the live manifest.json file.
// Without this, tests would break whenever manifest.json changes.
vi.mock("@/lib/manifest", () => {
  return {
    getManifest: () => ({
      system: {
        name: "TestOrg",
        tagline: "Test Platform",
        total_repos: 3,
        active_repos: 2,
        archived_repos: 1,
        total_organs: 2,
        sprints_completed: 10,
        launch_date: "2025-01-01",
        ci_workflows: 8,
        dependency_edges: 12,
        published_essays: 4,
        sprint_names: ["Alpha Sprint", "Beta Sprint"],
      },
      organs: [
        { key: "ORGAN-I",  name: "Core",  greek: "Alpha", domain: "platform", repo_count: 2 },
        { key: "ORGAN-II", name: "Front", greek: "Beta",  domain: "ui",       repo_count: 1 },
      ],
      repos: [
        {
          slug: "auth-service",
          name: "auth-service",
          display_name: "Auth Service",
          description: "Authentication and authorization engine",
          ai_context: "Handles auth for all products",
          organ: "ORGAN-I",
          tier: "core",
          status: "active",
          promotion_status: "promoted",
          tech_stack: ["typescript", "postgres"],
          github_url: "https://github.com/org/auth-service",
          deployment_urls: ["https://auth.example.com"],
          dependencies: [],
          sections: { overview: "Core auth component" },
          git_stats: { total_commits: 200, weekly_velocity: 8, last_commit: "2026-03-01T00:00:00Z" },
        },
        {
          slug: "dashboard-ui",
          name: "dashboard-ui",
          display_name: "Dashboard UI",
          description: "React-based admin dashboard",
          ai_context: "Visual frontend for operators",
          organ: "ORGAN-II",
          tier: "standard",
          status: "active",
          promotion_status: "none",
          tech_stack: ["react", "typescript"],
          github_url: "https://github.com/org/dashboard-ui",
          deployment_urls: ["https://dashboard.example.com"],
          dependencies: ["auth-service"],
          sections: { architecture: "SPA using Vite" },
          git_stats: { total_commits: 80, weekly_velocity: 3, last_commit: "2026-02-15T00:00:00Z" },
        },
        {
          slug: "legacy-batch",
          name: "legacy-batch",
          display_name: "Legacy Batch",
          description: "Archived batch processor",
          ai_context: "Old batch system, no longer active",
          organ: "ORGAN-I",
          tier: "archived",
          status: "archived",
          promotion_status: "none",
          tech_stack: ["python"],
          github_url: "https://github.com/org/legacy-batch",
          deployment_urls: [],
          dependencies: [],
          sections: {},
          git_stats: { total_commits: 15, weekly_velocity: 0, last_commit: "2023-01-01T00:00:00Z" },
        },
      ],
      deployments: [
        { repo: "auth-service",  url: "https://auth.example.com" },
        { repo: "dashboard-ui", url: "https://dashboard.example.com" },
      ],
      dependency_graph: { nodes: [], edges: [] },
    }),
  };
});

import { buildTier1Context, buildTier2Context } from "@/lib/retrieval";

// ─── buildTier1Context ────────────────────────────────────────────────────────

describe("buildTier1Context", () => {
  it("returns a string containing the system summary header", () => {
    const tier1 = buildTier1Context();
    expect(tier1).toContain("ORGANVM System Summary");
  });

  it("includes total repo counts from manifest", () => {
    const tier1 = buildTier1Context();
    expect(tier1).toContain("Total repos: 3");
    expect(tier1).toContain("Active: 2");
  });

  it("lists organ names and keys", () => {
    const tier1 = buildTier1Context();
    expect(tier1).toContain("ORGAN-I");
    expect(tier1).toContain("ORGAN-II");
    expect(tier1).toContain("Core");
    expect(tier1).toContain("Front");
  });

  it("includes live deployment URLs", () => {
    const tier1 = buildTier1Context();
    expect(tier1).toContain("Live deployments");
    expect(tier1).toContain("auth.example.com");
  });

  it("includes sprint names from manifest", () => {
    const tier1 = buildTier1Context();
    expect(tier1).toContain("Alpha Sprint");
    expect(tier1).toContain("Beta Sprint");
  });
});

// ─── buildTier2Context ────────────────────────────────────────────────────────

describe("buildTier2Context", () => {
  it("returns repos from the mentioned ORGAN-I when organ key is in query", () => {
    const tier2 = buildTier2Context("ORGAN-I repos");
    // Should include at least one ORGAN-I repo
    expect(tier2).toContain("Auth Service");
  });

  it("returns repos matching keyword 'auth'", () => {
    const tier2 = buildTier2Context("auth");
    // auth-service slug and name match the term 'auth'
    expect(tier2).toContain("auth-service");
    expect(tier2.length).toBeGreaterThan(0);
  });

  it("returns repos matching React/frontend keywords", () => {
    const tier2 = buildTier2Context("react dashboard");
    expect(tier2).toContain("dashboard-ui");
  });

  it("returns top repos by commit count for empty query (fallback path)", () => {
    const tier2 = buildTier2Context("");
    // auth-service has most commits (200) — should appear
    expect(tier2).toContain("auth-service");
  });

  it("falls back to top repos when no keyword matches — result must be non-empty", () => {
    const tier2 = buildTier2Context("xyzzy zork plugh");
    // The fallback returns the first 10 repos formatted — must not be blank
    expect(tier2.trim().length).toBeGreaterThan(50); // meaningful content, not just whitespace
    expect(tier2).toContain("auth-service"); // top repo by position in manifest
  });
});
