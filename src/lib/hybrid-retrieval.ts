/**
 * Hybrid Retrieval System
 *
 * Combines lexical scoring, TF-IDF vector similarity, and
 * knowledge graph traversal for multi-signal retrieval.
 */

import type { Repo } from "./types";
import { getManifest } from "./manifest";
import { getKnowledgeGraph } from "./graph";
import { getEntityRegistry } from "./entity-registry";
import { buildTier1Context } from "./retrieval";
import { incrementCounter, recordTiming } from "./observability";
import { db } from "./db";
import { documentChunks } from "./db/schema";
import { cosineDistance } from "drizzle-orm";
import { desc, sql } from "drizzle-orm";
import { fetchFederatedKnowledge } from "./knowledge-base-connector";

// ---------------------------------------------------------------------------
// Retrieval result
// ---------------------------------------------------------------------------

export interface RetrievalSource {
  id: string;
  type: "repo" | "entity" | "graph" | "manifest";
  name: string;
  display_name: string;
  relevance: number;       // 0.0 – 1.0
  freshness: number;       // 0.0 – 1.0 (1.0 = very recent)
  confidence: number;      // 0.0 – 1.0
  snippet: string;         // relevant text excerpt
  url: string | null;      // link to source
  source_type: string;     // "github" | "workspace" | "manifest"
  retrieved_at: string;
}

export interface HybridRetrievalResult {
  query: string;
  sources: RetrievalSource[];
  context: string;           // assembled context for LLM
  tier1: string;             // system overview
  strategy: string;          // which retrieval strategies were used
  total_candidates: number;
}

export interface HybridRetrieveOptions {
  maxSources?: number;
  includeGraph?: boolean;
  disableCache?: boolean;
}

// ---------------------------------------------------------------------------
// TF-IDF helpers (lightweight, in-memory)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function computeTfIdf(
  queryTokens: string[],
  docTokens: string[],
  corpusSize: number,
  docFreqs: Map<string, number>
): number {
  if (docTokens.length === 0 || queryTokens.length === 0) return 0;

  const docTokenSet = new Map<string, number>();
  for (const token of docTokens) {
    docTokenSet.set(token, (docTokenSet.get(token) || 0) + 1);
  }

  let score = 0;
  for (const qt of queryTokens) {
    const tf = (docTokenSet.get(qt) || 0) / docTokens.length;
    const df = docFreqs.get(qt) || 1;
    const idf = Math.log(corpusSize / df);
    score += tf * idf;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Stop words
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "what", "which", "show", "give",
  "tell", "about", "from", "have", "has", "that", "this", "last",
  "how", "does", "can", "are", "was", "were", "been", "being",
  "will", "would", "could", "should", "may", "might",
]);

const retrievalCache = new Map<string, { expires_at: number; result: HybridRetrievalResult }>();

function getCacheTtlMs(): number {
  const raw = process.env.HYBRID_RETRIEVAL_CACHE_TTL_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return 30_000;
}

function cloneResult(result: HybridRetrievalResult): HybridRetrievalResult {
  return JSON.parse(JSON.stringify(result)) as HybridRetrievalResult;
}

function makeCacheKey(query: string, options: HybridRetrieveOptions): string {
  return JSON.stringify({
    query,
    maxSources: options.maxSources ?? 15,
    includeGraph: options.includeGraph ?? true,
  });
}

function rewriteQuery(query: string): string {
  return query
    .replace(/\bvs\.\b/gi, "versus")
    .replace(/[^\w\s:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resetHybridRetrievalCache(): void {
  retrievalCache.clear();
}

// ---------------------------------------------------------------------------
// Hybrid retrieval
// ---------------------------------------------------------------------------

export async function hybridRetrieve(
  query: string,
  options: HybridRetrieveOptions = {}
): Promise<HybridRetrievalResult> {
  const startedMs = Date.now();
  const rewrittenQuery = rewriteQuery(query);
  const cacheKey = makeCacheKey(rewrittenQuery, options);
  const cacheEntry = retrievalCache.get(cacheKey);
  const cacheTtlMs = getCacheTtlMs();
  if (!options.disableCache && cacheEntry && cacheEntry.expires_at >= Date.now()) {
    incrementCounter("retrieval.cache_hit_total");
    recordTiming("retrieval.duration_ms", Date.now() - startedMs, { cached: true });
    return cloneResult(cacheEntry.result);
  }

  incrementCounter("retrieval.cache_miss_total");
  const maxSources = options?.maxSources ?? 15;
  const includeGraph = options?.includeGraph ?? true;
  const manifest = getManifest();
  const strategies: string[] = [];

  const queryTokens = tokenize(rewrittenQuery).filter((t) => !STOP_WORDS.has(t));
  const sources: RetrievalSource[] = [];

  // -------------------------------------------------------------------------
  // Strategy 1: Lexical scoring (existing retrieval logic)
  // -------------------------------------------------------------------------
  strategies.push("lexical");

  // Build document frequency map for TF-IDF
  const allDocs: Array<{ repo: Repo; tokens: string[] }> = manifest.repos.map((r) => ({
    repo: r,
    tokens: tokenize(
      [r.name, r.display_name, r.description, r.ai_context, ...Object.values(r.sections)].join(" ")
    ),
  }));

  const docFreqs = new Map<string, number>();
  for (const doc of allDocs) {
    const unique = new Set(doc.tokens);
    for (const token of unique) {
      docFreqs.set(token, (docFreqs.get(token) || 0) + 1);
    }
  }

  // -------------------------------------------------------------------------
  // Strategy 2: TF-IDF vector similarity
  // -------------------------------------------------------------------------
  strategies.push("tfidf");

  const scoredRepos: Array<{ repo: Repo; lexical: number; tfidf: number; combined: number }> = [];

  for (const doc of allDocs) {
    const lexical = scoreLexical(doc.repo, queryTokens);
    const tfidf = computeTfIdf(queryTokens, doc.tokens, allDocs.length, docFreqs);

    // Combine scores with weights
    const combined = lexical * 0.6 + tfidf * 100 * 0.4;
    scoredRepos.push({ repo: doc.repo, lexical, tfidf, combined });
  }

  scoredRepos.sort((a, b) => b.combined - a.combined);

  // Convert top repos to sources
  const topRepos = scoredRepos.filter((s) => s.combined > 0).slice(0, maxSources);
  const maxScore = topRepos[0]?.combined || 1;

  for (const scored of topRepos) {
    const r = scored.repo;
    const relevance = scored.combined / maxScore;
    const freshness = computeFreshness(r.git_stats.last_commit);

    sources.push({
      id: `repo:${r.slug}`,
      type: "repo",
      name: r.name,
      display_name: r.display_name,
      relevance,
      freshness,
      confidence: Math.min(1, relevance * 0.8 + freshness * 0.2),
      snippet: buildRepoSnippet(r, queryTokens),
      url: `/repos/${r.slug}`,
      source_type: "manifest",
      retrieved_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Strategy 3: Knowledge graph traversal
  // -------------------------------------------------------------------------
  if (includeGraph) {
    strategies.push("graph");
    const graph = getKnowledgeGraph();
    const registry = getEntityRegistry();

    // Find matching entities in the graph
    for (const token of queryTokens) {
      const results = registry.search(token, 5);
      for (const result of results) {
        // Skip if already in sources
        if (sources.some((s) => s.id === result.entity.id)) continue;

        // Get graph context (neighbors)
        const neighbors = graph.neighbors(result.entity.id, "both");
        const neighborNames = neighbors
          .slice(0, 3)
          .map((n) => n.entity.display_name)
          .join(", ");

        sources.push({
          id: result.entity.id,
          type: "entity",
          name: result.entity.name,
          display_name: result.entity.display_name,
          relevance: result.confidence * 0.8,
          freshness: computeFreshness(result.entity.envelope.valid_from),
          confidence: result.confidence,
          snippet: `${result.entity.description}${neighborNames ? ` (connected to: ${neighborNames})` : ""}`,
          url: null,
          source_type: result.entity.envelope.source_type,
          retrieved_at: new Date().toISOString(),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Strategy 4: Semantic search (PgVector)
  // -------------------------------------------------------------------------
  try {
    const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL || "https://api.openai.com/v1/embeddings";
    const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;
    const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

    const embedRes = await fetch(EMBEDDING_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(EMBEDDING_API_KEY ? { Authorization: `Bearer ${EMBEDDING_API_KEY}` } : {}),
      },
      body: JSON.stringify({ input: rewrittenQuery, model: EMBEDDING_MODEL }),
      signal: AbortSignal.timeout(3000), // 3s timeout so it degrades gracefully
    });

    if (embedRes.ok) {
      const data = await embedRes.json();
      const embedding = data.data?.[0]?.embedding;

      if (embedding) {
        strategies.push("semantic");
        const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, embedding)})`;
        const similarChunks = await db
          .select({
            id: documentChunks.id,
            repo: documentChunks.repo,
            organ: documentChunks.organ,
            path: documentChunks.path,
            content: documentChunks.content,
            similarity,
          })
          .from(documentChunks)
          .where(sql`${similarity} > 0.6`)
          .orderBy((t) => desc(t.similarity))
          .limit(5);

        for (const chunk of similarChunks) {
          sources.push({
            id: chunk.id,
            type: "repo",
            name: `${chunk.repo}/${chunk.path}`,
            display_name: `${chunk.repo}/${chunk.path}`,
            relevance: chunk.similarity,
            freshness: 0.9,
            confidence: Math.min(1, chunk.similarity * 0.9),
            snippet: chunk.content,
            url: `/repos/${chunk.repo}/tree/main/${chunk.path}`,
            source_type: "corpus",
            retrieved_at: new Date().toISOString(),
          });
        }
      }
    }
  } catch (error) {
    console.warn("Semantic vector retrieval failed or skipped:", error);
  }

  // -------------------------------------------------------------------------
  // Strategy 5: Personal Knowledge Federation
  // -------------------------------------------------------------------------
  strategies.push("federated");
  const federatedSources = await fetchFederatedKnowledge(rewrittenQuery);
  sources.push(...federatedSources);

  // Sort all sources by combined relevance
  sources.sort((a, b) => b.relevance - a.relevance);
  const finalSources = sources.slice(0, maxSources);

  // -------------------------------------------------------------------------
  // Assemble context
  // -------------------------------------------------------------------------
  const tier1 = buildTier1Context();
  const context = assembleContext(finalSources, tier1);
  const result: HybridRetrievalResult = {
    query,
    sources: finalSources,
    context,
    tier1,
    strategy: strategies.join("+"),
    total_candidates: scoredRepos.length + (includeGraph ? sources.length : 0),
  };

  if (!options.disableCache && cacheTtlMs > 0) {
    retrievalCache.set(cacheKey, {
      expires_at: Date.now() + cacheTtlMs,
      result: cloneResult(result),
    });
  }

  recordTiming("retrieval.duration_ms", Date.now() - startedMs, { cached: false });
  return result;
}

// ---------------------------------------------------------------------------
// Lexical scoring (from existing retrieval.ts)
// ---------------------------------------------------------------------------

function scoreLexical(repo: Repo, terms: string[]): number {
  let score = 0;
  const slugL = repo.slug.toLowerCase();
  const nameL = repo.name.toLowerCase();
  const displayL = repo.display_name.toLowerCase();
  const descL = repo.description.toLowerCase();
  const contextL = repo.ai_context.toLowerCase();
  const sectionsL = Object.values(repo.sections || {}).join(" ").toLowerCase();

  for (const term of terms) {
    if (slugL.includes(term)) score += 25;
    if (nameL.includes(term)) score += 20;
    if (displayL.includes(term)) score += 15;
    if (descL.includes(term)) score += 10;
    if (sectionsL.includes(term)) score += 7;
    if (repo.organ.toLowerCase().includes(term)) score += 8;
    if (repo.tech_stack.some((t) => t.toLowerCase().includes(term))) score += 5;
    if (contextL.includes(term)) score += 2;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

function assembleContext(sources: RetrievalSource[], tier1: string): string {
  const parts: string[] = [tier1, "\n=== EVIDENCE-GROUNDED SOURCES ===\n"];

  for (const source of sources) {
    const freshLabel = source.freshness >= 0.8 ? "FRESH" :
                       source.freshness >= 0.5 ? "RECENT" : "AGED";
    parts.push(
      `[${source.type.toUpperCase()}] ${source.display_name} ` +
      `(relevance: ${(source.relevance * 100).toFixed(0)}%, ` +
      `confidence: ${(source.confidence * 100).toFixed(0)}%, ` +
      `freshness: ${freshLabel})` +
      `${source.url ? ` — ${source.url}` : ""}\n` +
      `${source.snippet}\n`
    );
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFreshness(dateStr: string | null | undefined): number {
  if (!dateStr) return 0.3; // unknown age → moderate
  const ageMs = Date.now() - new Date(dateStr).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 1) return 1.0;
  if (ageDays < 7) return 0.9;
  if (ageDays < 30) return 0.7;
  if (ageDays < 90) return 0.5;
  return 0.3;
}

function buildRepoSnippet(repo: Repo, queryTokens: string[]): string {
  // Try to find the most relevant section
  for (const [, content] of Object.entries(repo.sections)) {
    const lower = content.toLowerCase();
    if (queryTokens.some((t) => lower.includes(t))) {
      return content.slice(0, 300);
    }
  }

  // Fallback to ai_context or description
  if (repo.ai_context) return repo.ai_context.slice(0, 300);
  return repo.description.slice(0, 300);
}
