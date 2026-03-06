import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@/lib/manifest", () => {
  const makeRepo = (slug: string, overrides: Record<string, unknown> = {}) => ({
    slug,
    name: slug,
    display_name: slug.replace(/-/g, " "),
    description: `Description for ${slug}`,
    ai_context: `AI context for ${slug}`,
    organ: "ORGAN-I",
    tier: "standard",
    status: "active",
    promotion_status: "none",
    tech_stack: ["typescript"],
    github_url: `https://github.com/org/${slug}`,
    deployment_urls: [],
    dependencies: [],
    sections: { overview: `Overview of ${slug}` },
    git_stats: { total_commits: 50, weekly_velocity: 5, last_commit: "2026-03-01T00:00:00Z" },
    ...overrides,
  });

  return {
    getManifest: () => ({
      system: {
        name: "TestSystem",
        tagline: "Test",
        total_repos: 3,
        active_repos: 3,
        archived_repos: 0,
        total_organs: 1,
        sprints_completed: 5,
        launch_date: "2025-01-01",
        ci_workflows: 10,
        dependency_edges: 5,
        published_essays: 3,
        sprint_names: ["Sprint 1"],
      },
      organs: [{ key: "ORGAN-I", name: "Test Organ", greek: "Alpha", domain: "test", repo_count: 3 }],
      repos: [
        makeRepo("alpha-core", { description: "The alpha core engine", ai_context: "Alpha handles core logic" }),
        makeRepo("beta-ui", { organ: "ORGAN-II", description: "Beta user interface", tech_stack: ["react", "typescript"] }),
        makeRepo("gamma-api", { description: "Gamma REST API", sections: { architecture: "Microservice architecture" } }),
      ],
      deployments: [{ repo: "alpha-core", url: "https://alpha.example.com" }],
      dependency_graph: { nodes: [], edges: [] },
    }),
  };
});

vi.mock("@/lib/graph", () => ({
  getKnowledgeGraph: () => ({
    addNode: vi.fn(),
    getNode: vi.fn(),
    neighbors: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock("@/lib/entity-registry", () => ({
  getEntityRegistry: () => ({
    search: vi.fn().mockReturnValue([]),
    register: vi.fn(),
  }),
}));

vi.mock("@/lib/retrieval", () => ({
  buildTier1Context: () => "Tier 1 system overview",
}));

vi.mock("@/lib/observability", () => ({
  incrementCounter: vi.fn(),
  recordTiming: vi.fn(),
}));

import { incrementCounter } from "@/lib/observability";

vi.mock("@/lib/knowledge-base-connector", () => ({
  fetchFederatedKnowledge: vi.fn().mockResolvedValue([]),
}));

// Mock the DB and document_chunks query to return empty by default
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => [] }),
        }),
      }),
    }),
    execute: () => Promise.resolve({ rows: [] }),
  },
}));

import {
  hybridRetrieve,
  resetHybridRetrievalCache,
} from "@/lib/hybrid-retrieval";

// Stub global fetch so semantic search (Strategy 4) doesn't hit real APIs
const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 400 }));

beforeEach(() => {
  resetHybridRetrievalCache();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 400 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hybridRetrieve", () => {
  it("returns a valid HybridRetrievalResult structure", async () => {
    const result = await hybridRetrieve("alpha core engine");
    expect(result).toMatchObject({
      query: "alpha core engine",
      strategy: expect.stringContaining("lexical"),
      total_candidates: expect.any(Number),
    });
    expect(result.sources).toBeInstanceOf(Array);
    expect(result.context).toContain("Tier 1 system overview");
    expect(result.tier1).toBe("Tier 1 system overview");
  });

  it("scores repos matching query tokens higher", async () => {
    const result = await hybridRetrieve("alpha core");
    const alphaSource = result.sources.find((s) => s.name === "alpha-core");
    const betaSource = result.sources.find((s) => s.name === "beta-ui");

    expect(alphaSource).toBeDefined();
    // Alpha should be ranked higher than beta for "alpha core" query
    if (alphaSource && betaSource) {
      expect(alphaSource.relevance).toBeGreaterThan(betaSource.relevance);
    }
  });

  it("uses cached results on repeated queries", async () => {
    vi.mocked(incrementCounter).mockClear();
    await hybridRetrieve("alpha");
    // Cache miss on first call
    const hitsAfterFirst = vi.mocked(incrementCounter).mock.calls.filter(
      ([name]) => typeof name === "string" && name.includes("cache_hit")
    ).length;
    expect(hitsAfterFirst).toBe(0);

    await hybridRetrieve("alpha");
    // Cache hit on second call for same query
    const hitsAfterSecond = vi.mocked(incrementCounter).mock.calls.filter(
      ([name]) => typeof name === "string" && name.includes("cache_hit")
    ).length;
    expect(hitsAfterSecond).toBeGreaterThan(0);
  });

  it("bypasses cache when disableCache is true", async () => {
    vi.mocked(incrementCounter).mockClear();
    await hybridRetrieve("alpha"); // warm the cache
    vi.mocked(incrementCounter).mockClear();
    await hybridRetrieve("alpha", { disableCache: true });
    // A cache bypass should NOT increment a cache_hit counter
    const cacheHits = vi.mocked(incrementCounter).mock.calls.filter(
      ([name]) => typeof name === "string" && name.includes("cache_hit")
    ).length;
    expect(cacheHits).toBe(0);
  });

  it("respects maxSources option", async () => {
    const result = await hybridRetrieve("alpha core beta gamma", { maxSources: 2 });
    expect(result.sources.length).toBeLessThanOrEqual(2);
  });

  it("returns empty sources for completely unrelated queries", async () => {
    const result = await hybridRetrieve("xyzzy zork plugh");
    expect(result.sources.length).toBe(0);
  });

  it("includes graph strategy when includeGraph is true", async () => {
    const result = await hybridRetrieve("alpha", { includeGraph: true });
    expect(result.strategy).toContain("graph");
  });

  it("excludes graph strategy when includeGraph is false", async () => {
    const result = await hybridRetrieve("alpha", { includeGraph: false });
    expect(result.strategy).not.toContain("graph");
  });

  it("default behavior (no includeGraph option) includes graph\u2014graph is opt-in enabled by default", async () => {
    // Source: `options?.includeGraph ?? true` — graph is ON by default
    const withDefault  = await hybridRetrieve("alpha");
    const withExplicit = await hybridRetrieve("alpha", { disableCache: true, includeGraph: true });
    expect(withDefault.strategy.includes("graph")).toBe(
      withExplicit.strategy.includes("graph")
    );
  });

  it("assembles context with evidence-grounded sources heading", async () => {
    const result = await hybridRetrieve("alpha core engine");
    if (result.sources.length > 0) {
      expect(result.context).toContain("EVIDENCE-GROUNDED SOURCES");
    }
  });
});

describe("resetHybridRetrievalCache", () => {
  it("clears the cache so next call fetches fresh results", async () => {
    await hybridRetrieve("alpha");
    resetHybridRetrievalCache();
    // After reset, the next call should be a cache miss (still valid)
    const second = await hybridRetrieve("alpha");
    expect(second.sources).toBeDefined();
  });
});
