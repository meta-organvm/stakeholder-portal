import { RetrievalSource } from "./hybrid-retrieval";
import type { QueryStrategy } from "./query-planner";
import { isNonPublicFacetExposureEnabled } from "./public-exposure-policy";

const MY_KNOWLEDGE_BASE_API_URL = process.env.MY_KNOWLEDGE_BASE_API_URL;
const MY_KNOWLEDGE_BASE_ENABLED = process.env.MY_KNOWLEDGE_BASE_ENABLED === "true";

export interface AtomicUnit {
  id: string;
  source: string; // e.g., "conversations", "scratchpad"
  content: string;
  timestamp: string;
  score?: number;
}

interface StrategyParams {
  maxResults: number;
  timeoutMs: number;
  relevanceMultiplier: number;
}

function getStrategyParams(strategy?: QueryStrategy): StrategyParams {
  switch (strategy) {
    case "meta_vision":
      return { maxResults: 8, timeoutMs: 4000, relevanceMultiplier: 1.05 };
    case "exploratory":
    case "cross_organ":
      return { maxResults: 5, timeoutMs: 3000, relevanceMultiplier: 0.9 };
    default:
      return { maxResults: 3, timeoutMs: 2000, relevanceMultiplier: 0.9 };
  }
}

export async function fetchFederatedKnowledge(
  query: string,
  strategy?: QueryStrategy,
): Promise<RetrievalSource[]> {
  if (
    !isNonPublicFacetExposureEnabled() ||
    !MY_KNOWLEDGE_BASE_ENABLED ||
    !MY_KNOWLEDGE_BASE_API_URL
  ) {
    return [];
  }

  const params = getStrategyParams(strategy);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const url = new URL(`${MY_KNOWLEDGE_BASE_API_URL}/search/hybrid`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", params.maxResults.toString());

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`[KnowledgeConnector] API returned ${res.status}: ${res.statusText}`);
      return [];
    }

    const json = await res.json();
    const results: AtomicUnit[] = json.results || json.data || json || [];

    return results.map((unit) => ({
      id: unit.id,
      type: "manifest" as const,
      name: `KB: ${unit.source}`,
      display_name: `Personal Knowledge Base`,
      relevance: (unit.score ?? 0.5) * params.relevanceMultiplier,
      freshness: 0.9,
      confidence: 0.8,
      snippet: unit.content.substring(0, 400),
      url: `${process.env.MY_KNOWLEDGE_BASE_UI_URL || "http://localhost:3000"}/unit/${unit.id}`,
      source_type: "knowledge_base",
      retrieved_at: new Date().toISOString(),
    }));
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === "AbortError") {
      console.warn(`[KnowledgeConnector] API request timed out after ${params.timeoutMs}ms`);
    } else {
      console.warn(`[KnowledgeConnector] Fallback - failed to reach my-knowledge-base API: ${err.message}`);
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
