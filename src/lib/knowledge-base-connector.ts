import { RetrievalSource } from "./hybrid-retrieval";

const MY_KNOWLEDGE_BASE_API_URL = process.env.MY_KNOWLEDGE_BASE_API_URL;
const MY_KNOWLEDGE_BASE_ENABLED = process.env.MY_KNOWLEDGE_BASE_ENABLED === "true";

export interface AtomicUnit {
  id: string;
  source: string; // e.g., "conversations", "scratchpad"
  content: string;
  timestamp: string;
  score?: number;
}

export async function fetchFederatedKnowledge(query: string, maxResults = 3): Promise<RetrievalSource[]> {
  if (!MY_KNOWLEDGE_BASE_ENABLED || !MY_KNOWLEDGE_BASE_API_URL) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const url = new URL(`${MY_KNOWLEDGE_BASE_API_URL}/search/hybrid`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", maxResults.toString());

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
      type: "manifest", // Standard structure enforcement
      name: `KB: ${unit.source}`,
      display_name: `Personal Knowledge Base`,
      relevance: (unit.score ?? 0.5) * 0.9, // Slight normalization decay against authoritative manifest
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
      console.warn(`[KnowledgeConnector] API request timed out after 2000ms`);
    } else {
      console.warn(`[KnowledgeConnector] Fallback - failed to reach my-knowledge-base API: ${err.message}`);
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
