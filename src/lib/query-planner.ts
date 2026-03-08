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
  | "deterministic"     // legacy — kept for type compat, now routes through LLM
  | "meta_vision"      // questions about purpose, identity, vision, meaning
  | "single_repo"      // focused on one repo
  | "organ_scope"      // scoped to an organ
  | "cross_organ"      // spans multiple organs
  | "system_wide"      // system-level metrics/overview
  | "graph_traversal"  // needs knowledge graph
  | "live_research"    // needs real-time external/tool info
  | "analytics"        // statistical or text analytics over corpus
  | "file_access"      // needs file/directory read from workspace
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
  /** Suggested follow-up prompts to improve answerability/relevance. */
  suggested_followups: string[];
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
  // Meta-vision: questions about purpose, identity, meaning, the creator's work
  {
    pattern: /(?:what is (?:this|organvm|the project|all this|this thing|this system)|what(?:'s| is) (?:the )?(?:point|purpose|vision|value|meaning|mission|philosophy)|why does (?:this|it|any of (?:this|that)) (?:matter|exist)|what did (?:he|she|they|you|your (?:friend|creator)) (?:make|build|create|do)|life(?:'s)? work|what(?:'s| is) the (?:big )?(?:deal|idea)|who (?:are you|made (?:this|you))|what(?:'s| is) (?:this|it) (?:all )?(?:about|for)|why should (?:i|we|anyone) care|sell me|convince me|elevator pitch|manifesto)/i,
    strategy: "meta_vision",
  },

  // Analytics
  {
    pattern: /(?:most (?:used|common) words?|word frequency|common phrases?)/i,
    strategy: "analytics",
  },

  // System-level queries (formerly deterministic — now all go through LLM)
  {
    pattern: /(?:repo count|how many repos?).*(?:per|each|by) organ/i,
    strategy: "system_wide",
  },
  {
    pattern: /flagship repos?/i,
    strategy: "system_wide",
  },
  {
    pattern: /(?:last|recent|latest) sprint/i,
    strategy: "system_wide",
  },
  {
    pattern: /deployed (?:product|deployment)/i,
    strategy: "system_wide",
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

  // File access — reading specific files, directory listings, file contents
  {
    pattern: /(?:show|read|cat|display|view|open|contents?\s*of)\s+(?:(?:the\s+)?(?:file\s+)?)?(\S+\/\S+)/i,
    strategy: "file_access",
    extract: (match, manifest) => {
      const fullPath = match[1];
      const slashIdx = fullPath.indexOf("/");
      const repoHint = slashIdx > 0 ? fullPath.slice(0, slashIdx) : fullPath;
      const repo = manifest.repos.find(
        (r) =>
          r.slug.includes(repoHint) ||
          r.name.toLowerCase().includes(repoHint.toLowerCase())
      );
      return {
        target_repos: repo ? [repo.slug] : [],
        answerability: repo ? "answerable" : "partial",
        answerability_reason: repo
          ? `File access for repo: ${repo.display_name}`
          : `Could not match repo from "${repoHint}"`,
      };
    },
  },
  {
    pattern: /(?:list|ls|what(?:'s| is)\s+in|files?\s+in|directory)\s+(\S+\/\S*)/i,
    strategy: "file_access",
  },
  {
    pattern: /(?:which repos?\s+have|repos?\s+with|repos?\s+containing)\s+(\S+)/i,
    strategy: "file_access",
  },

  // Live research / External queries — last resort, requires genuinely external intent
  {
    pattern: /(?:market\s+(?:research|analysis|trends|share)|competitor\s+(?:analysis|news|comparison)|(?:news|headlines)\s+(?:about|on|for)|real-time\s+(?:data|feed)|search\s+(?:the\s+)?(?:web|internet|online))/i,
    strategy: "live_research",
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
    suggested_followups: [],
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
      plan.suggested_max_tokens = 800;
      break;
    case "meta_vision":
      plan.suggested_max_tokens = 1800;
      break;
    case "single_repo":
      plan.suggested_max_tokens = 800;
      break;
    case "organ_scope":
      plan.suggested_max_tokens = 1000;
      break;
    case "file_access":
      plan.suggested_max_tokens = 2000;
      break;
    case "system_wide":
    case "cross_organ":
    case "graph_traversal":
    case "live_research":
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

  plan.suggested_followups = buildFollowups(plan, manifest);

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
    case "meta_vision": cost = 5; break;
    case "single_repo": cost = 2; break;
    case "file_access": cost = 3; break;
    case "organ_scope": cost = 4; break;
    case "system_wide": cost = 5; break;
    case "cross_organ": cost = 6; break;
    case "graph_traversal": cost = 7; break;
    case "live_research": cost = 9; break;
    case "exploratory": cost = 8; break;
  }

  // Sub-queries add cost
  cost += plan.sub_queries.length;

  return Math.min(10, cost);
}

function buildFollowups(plan: QueryPlan, manifest: Manifest): string[] {
  const followups: string[] = [];

  if (plan.strategy === "live_research") {
    followups.push("Which ORGANVM repo or organ should I scope this to?");
    followups.push("Ask for the latest internal sprint or deployment status.");
  }

  if (plan.strategy === "single_repo" && plan.target_repos.length === 0) {
    const examples = manifest.repos
      .slice(0, 3)
      .map((repo) => repo.display_name);
    if (examples.length > 0) {
      followups.push(
        `Name a repo explicitly (for example: ${examples.map((e) => `"${e}"`).join(", ")}).`
      );
    }
  }

  if (plan.strategy === "graph_traversal") {
    followups.push("Name the starting repo/entity to trace dependencies or impact.");
  }

  if (plan.strategy === "cross_organ" && plan.target_organs.length < 2) {
    followups.push("Specify at least two organs to compare (for example: ORGAN-I vs ORGAN-III).");
  }

  if (plan.answerability !== "answerable") {
    followups.push("Specify exact organ/repo/deployment scope for evidence-backed results.");
    followups.push("I can answer using current internal snapshot data if you narrow scope.");
  }

  return [...new Set(followups)].slice(0, 4);
}
