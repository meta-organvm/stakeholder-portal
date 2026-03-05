/**
 * Query Planner
 *
 * Cost-based strategy selection, query decomposition,
 * and answerability classification.
 */

import type { Manifest } from "./types";
import { getManifest } from "./manifest";

// ---------------------------------------------------------------------------
// Query plan types
// ---------------------------------------------------------------------------

export type QueryStrategy =
  | "deterministic"     // direct answer from manifest, no LLM
  | "single_repo"      // focused on one repo
  | "organ_scope"      // scoped to an organ
  | "cross_organ"      // spans multiple organs
  | "system_wide"      // system-level metrics/overview
  | "graph_traversal"  // needs knowledge graph
  | "exploratory";     // open-ended, needs broad retrieval

export interface QueryPlan {
  original_query: string;
  strategy: QueryStrategy;
  /** Decomposed sub-queries (for complex questions). */
  sub_queries: string[];
  /** Specific repos to focus retrieval on. */
  target_repos: string[];
  /** Specific organs to scope retrieval to. */
  target_organs: string[];
  /** Whether the query is answerable given current data. */
  answerability: "answerable" | "partial" | "unanswerable";
  /** Reason for answerability classification. */
  answerability_reason: string;
  /** Estimated cost (1-10) for retrieval. */
  estimated_cost: number;
  /** Suggested max tokens for response. */
  suggested_max_tokens: number;
}

// ---------------------------------------------------------------------------
// Query classification patterns
// ---------------------------------------------------------------------------

interface QueryPattern {
  pattern: RegExp;
  strategy: QueryStrategy;
  extract?: (match: RegExpMatchArray, manifest: Manifest) => Partial<QueryPlan>;
}

const PATTERNS: QueryPattern[] = [
  // System-level deterministic
  {
    pattern: /^what is organvm\??$/i,
    strategy: "deterministic",
  },
  {
    pattern: /(?:repo count|how many repos?).*(?:per|each|by) organ/i,
    strategy: "deterministic",
  },
  {
    pattern: /flagship repos?/i,
    strategy: "deterministic",
  },
  {
    pattern: /(?:last|recent|latest) sprint/i,
    strategy: "deterministic",
  },
  {
    pattern: /deployed (?:product|deployment)/i,
    strategy: "deterministic",
  },

  // Tech stack for specific repo
  {
    pattern: /tech\s*stack\s*(?:for|of)\s+(.+?)(?:[?.!]|$)/i,
    strategy: "single_repo",
    extract: (match, manifest) => {
      const hint = match[1].trim().toLowerCase();
      const repo = manifest.repos.find(
        (r) =>
          r.slug.includes(hint) ||
          r.name.toLowerCase().includes(hint) ||
          r.display_name.toLowerCase().includes(hint)
      );
      return {
        target_repos: repo ? [repo.slug] : [],
        answerability: repo ? "answerable" : "partial",
        answerability_reason: repo
          ? `Found repo: ${repo.display_name}`
          : `No exact match for "${hint}"`,
      };
    },
  },

  // Organ-specific queries
  {
    pattern: /(?:organ|about)\s+(?:i{1,3}v?|v{1,3}|meta)/i,
    strategy: "organ_scope",
  },

  // Dependency/graph queries
  {
    pattern: /(?:depend|upstream|downstream|impact|connect|relationship)/i,
    strategy: "graph_traversal",
  },

  // Comparison queries
  {
    pattern: /(?:compare|difference|versus|vs\.?)\s/i,
    strategy: "cross_organ",
  },

  // Status/health queries
  {
    pattern: /(?:status|health|overview|summary|progress)/i,
    strategy: "system_wide",
  },
];

// ---------------------------------------------------------------------------
// Organ detection
// ---------------------------------------------------------------------------

const ORGAN_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /organ[\s-]*i\b|theoria/i, key: "ORGAN-I" },
  { pattern: /organ[\s-]*ii\b|poiesis/i, key: "ORGAN-II" },
  { pattern: /organ[\s-]*iii\b|ergon/i, key: "ORGAN-III" },
  { pattern: /organ[\s-]*iv\b|taxis/i, key: "ORGAN-IV" },
  { pattern: /organ[\s-]*v\b|logos/i, key: "ORGAN-V" },
  { pattern: /organ[\s-]*vi\b|koinonia/i, key: "ORGAN-VI" },
  { pattern: /organ[\s-]*vii\b|kerygma/i, key: "ORGAN-VII" },
  { pattern: /meta[\s-]*organvm|organ[\s-]*viii/i, key: "META-ORGANVM" },
];

function detectOrgans(query: string): string[] {
  const matched: string[] = [];
  for (const { pattern, key } of ORGAN_PATTERNS) {
    if (pattern.test(query)) matched.push(key);
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Repo detection
// ---------------------------------------------------------------------------

function detectRepos(query: string, manifest: Manifest): string[] {
  const queryLower = query.toLowerCase();
  const matches: Array<{ slug: string; score: number }> = [];

  for (const repo of manifest.repos) {
    let score = 0;
    if (queryLower.includes(repo.slug)) score += 10;
    if (queryLower.includes(repo.name.toLowerCase())) score += 8;
    if (queryLower.includes(repo.display_name.toLowerCase())) score += 6;

    if (score > 0) matches.push({ slug: repo.slug, score });
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((m) => m.slug);
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

export function planQuery(query: string): QueryPlan {
  const manifest = getManifest();
  const trimmed = query.trim();

  // Default plan
  const plan: QueryPlan = {
    original_query: trimmed,
    strategy: "exploratory",
    sub_queries: [],
    target_repos: [],
    target_organs: [],
    answerability: "answerable",
    answerability_reason: "Query can be answered from available data",
    estimated_cost: 5,
    suggested_max_tokens: 1200,
  };

  // Check patterns
  for (const p of PATTERNS) {
    const match = trimmed.match(p.pattern);
    if (match) {
      plan.strategy = p.strategy;
      if (p.extract) {
        Object.assign(plan, p.extract(match, manifest));
      }
      break;
    }
  }

  // Detect organs and repos
  const organs = detectOrgans(trimmed);
  if (organs.length > 0) {
    plan.target_organs = organs;
    if (organs.length > 1) {
      plan.strategy = "cross_organ";
    } else if (plan.strategy === "exploratory") {
      plan.strategy = "organ_scope";
    }
  }

  const repos = detectRepos(trimmed, manifest);
  if (repos.length > 0) {
    plan.target_repos = repos;
    if (plan.strategy === "exploratory" && repos.length === 1) {
      plan.strategy = "single_repo";
    }
  }

  // Decompose complex queries
  plan.sub_queries = decomposeQuery(trimmed);

  // Estimate cost
  plan.estimated_cost = estimateCost(plan);

  // Set max tokens based on strategy
  switch (plan.strategy) {
    case "deterministic":
      plan.suggested_max_tokens = 500;
      break;
    case "single_repo":
      plan.suggested_max_tokens = 800;
      break;
    case "organ_scope":
      plan.suggested_max_tokens = 1000;
      break;
    case "system_wide":
    case "cross_organ":
    case "graph_traversal":
      plan.suggested_max_tokens = 1500;
      break;
    case "exploratory":
      plan.suggested_max_tokens = 1200;
      break;
  }

  // Answerability check
  if (plan.strategy !== "deterministic" && plan.target_repos.length === 0 && plan.target_organs.length === 0) {
    // Check if query mentions things outside our data
    const outsidePatterns = [
      /(?:price|cost|revenue|salary|hiring)/i,
      /(?:competitor|market\s*share)/i,
      /(?:personal|private|password|secret)/i,
    ];
    for (const op of outsidePatterns) {
      if (op.test(trimmed)) {
        plan.answerability = "partial";
        plan.answerability_reason = "Query may reference data outside the system manifest";
        break;
      }
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Query decomposition
// ---------------------------------------------------------------------------

function decomposeQuery(query: string): string[] {
  // Split on conjunctions and question separators
  const parts = query
    .split(/\s*(?:and also|and then|and|also|additionally|plus)\s+/i)
    .filter((p) => p.trim().length > 5);

  if (parts.length <= 1) return [];

  return parts.map((p) => p.trim());
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

function estimateCost(plan: QueryPlan): number {
  let cost = 1;

  switch (plan.strategy) {
    case "deterministic": cost = 1; break;
    case "single_repo": cost = 2; break;
    case "organ_scope": cost = 4; break;
    case "system_wide": cost = 5; break;
    case "cross_organ": cost = 6; break;
    case "graph_traversal": cost = 7; break;
    case "exploratory": cost = 8; break;
  }

  // Sub-queries add cost
  cost += plan.sub_queries.length;

  return Math.min(10, cost);
}
