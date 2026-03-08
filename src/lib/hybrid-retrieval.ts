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
import { documentChunks, repoFileTrees, codeSymbols } from "./db/schema";
import { cosineDistance } from "drizzle-orm";
import { desc, sql } from "drizzle-orm";
import { fetchFederatedKnowledge } from "./knowledge-base-connector";
import { readFile, listDirectory, isFileAccessAvailable } from "./file-reader";

// ---------------------------------------------------------------------------
// Retrieval result
// ---------------------------------------------------------------------------

export interface RetrievalSource {
  id: string;
  type: "repo" | "entity" | "graph" | "manifest" | "file_tree" | "symbol" | "file_content";
  name: string;
  display_name: string;
  relevance: number;       // 0.0 – 1.0
  freshness: number;       // 0.0 – 1.0 (1.0 = very recent)
  confidence: number;      // 0.0 – 1.0
  snippet: string;         // relevant text excerpt
  url: string | null;      // link to source
  source_type: string;     // "github" | "workspace" | "manifest" | "file_tree" | "symbol" | "on_demand"
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
  boostVision?: boolean;
  queryStrategy?: import("./query-planner").QueryStrategy;
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
  const boostVision = options?.boostVision ?? false;
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
      [r.name, r.display_name, r.description, r.ai_context, ...Object.values(r.sections), ...(r.file_index ?? [])].join(" ")
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
  // Strategy 2.5: File tree search (Phase 1D)
  // -------------------------------------------------------------------------
  const filePathPatterns = queryTokens.filter(
    (t) => t.includes(".") || t.includes("/") || /^(src|lib|test|scripts|config|docker|ci|workflow)$/i.test(t)
  );

  if (filePathPatterns.length > 0) {
    try {
      strategies.push("file_tree");
      const conditions = filePathPatterns.map((p) => sql`${repoFileTrees.path} ILIKE ${"%" + p + "%"}`);
      const combinedCondition = conditions.length === 1
        ? conditions[0]
        : sql`(${sql.join(conditions, sql` OR `)})`;

      const treeResults = await db
        .select({
          id: repoFileTrees.id,
          repo: repoFileTrees.repo,
          organ: repoFileTrees.organ,
          path: repoFileTrees.path,
          fileType: repoFileTrees.fileType,
          extension: repoFileTrees.extension,
          sizeBytes: repoFileTrees.sizeBytes,
        })
        .from(repoFileTrees)
        .where(combinedCondition)
        .limit(20);

      for (const row of treeResults) {
        const sizeInfo = row.sizeBytes ? ` (${(row.sizeBytes / 1024).toFixed(1)}KB)` : "";
        sources.push({
          id: row.id,
          type: "file_tree",
          name: `${row.repo}/${row.path}`,
          display_name: `${row.repo}/${row.path}`,
          relevance: 0.7,
          freshness: 0.5,
          confidence: 0.8,
          snippet: `[${row.fileType}] ${row.repo}/${row.path}${sizeInfo}${row.extension ? ` (${row.extension})` : ""}`,
          url: `/repos/${row.repo}`,
          source_type: "file_tree",
          retrieved_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn("File tree search failed:", err);
    }
  }

  // -------------------------------------------------------------------------
  // Strategy 2.7: Symbol search (Phase 2D)
  // -------------------------------------------------------------------------
  const identifierPatterns = queryTokens.filter(
    (t) => /[A-Z]/.test(t) || t.includes("_") || t.length > 4
  );

  if (identifierPatterns.length > 0) {
    try {
      strategies.push("symbol");
      const symConditions = identifierPatterns.map((p) => sql`${codeSymbols.name} ILIKE ${"%" + p + "%"}`);
      const symCombined = symConditions.length === 1
        ? symConditions[0]
        : sql`(${sql.join(symConditions, sql` OR `)})`;

      const symbolResults = await db
        .select({
          id: codeSymbols.id,
          repo: codeSymbols.repo,
          path: codeSymbols.path,
          symbolType: codeSymbols.symbolType,
          name: codeSymbols.name,
          signature: codeSymbols.signature,
          lineStart: codeSymbols.lineStart,
          lineEnd: codeSymbols.lineEnd,
          docComment: codeSymbols.docComment,
          visibility: codeSymbols.visibility,
        })
        .from(codeSymbols)
        .where(symCombined)
        .limit(15);

      for (const sym of symbolResults) {
        const lines = sym.lineEnd && sym.lineStart ? ` (L${sym.lineStart}–${sym.lineEnd})` : "";
        const doc = sym.docComment ? `\n${sym.docComment.slice(0, 150)}` : "";
        sources.push({
          id: sym.id,
          type: "symbol",
          name: `${sym.repo}/${sym.path}:${sym.name}`,
          display_name: `${sym.symbolType} ${sym.name} in ${sym.repo}/${sym.path}`,
          relevance: 0.75,
          freshness: 0.5,
          confidence: 0.85,
          snippet: `[${sym.visibility || ""}${sym.symbolType}] ${sym.signature || sym.name}${lines}${doc}`,
          url: `/repos/${sym.repo}`,
          source_type: "symbol",
          retrieved_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn("Symbol search failed:", err);
    }
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
    const isHuggingFace = EMBEDDING_API_URL.includes("huggingface.co") || EMBEDDING_API_URL.includes("hf-inference");

    const embedRes = await fetch(EMBEDDING_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(EMBEDDING_API_KEY ? { Authorization: `Bearer ${EMBEDDING_API_KEY}` } : {}),
      },
      body: isHuggingFace
        ? JSON.stringify({ inputs: rewrittenQuery })
        : JSON.stringify({ input: rewrittenQuery, model: EMBEDDING_MODEL }),
      signal: AbortSignal.timeout(5000),
    });

    if (embedRes.ok) {
      const data = await embedRes.json();
      const embedding = isHuggingFace
        ? (Array.isArray(data[0]) ? data[0] : data)
        : data.data?.[0]?.embedding;

      if (embedding) {
        strategies.push("semantic");
        const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, embedding)})`;
        const semanticLimit = boostVision ? 20 : 10;
        const similarChunks = await db
          .select({
            id: documentChunks.id,
            repo: documentChunks.repo,
            organ: documentChunks.organ,
            path: documentChunks.path,
            content: documentChunks.content,
            contentClass: documentChunks.contentClass,
            ingestedAt: documentChunks.ingestedAt,
            similarity,
          })
          .from(documentChunks)
          .where(sql`${similarity} > 0.40`)
          .orderBy((t) => desc(t.similarity))
          .limit(semanticLimit);

        for (const chunk of similarChunks) {
          // Freshness boost: recently ingested chunks get a relevance bump
          const ageHours = chunk.ingestedAt
            ? (Date.now() - new Date(chunk.ingestedAt).getTime()) / 3_600_000
            : Infinity;
          const freshnessBoost = ageHours < 24 ? 0.1 : ageHours < 168 ? 0.05 : 0;
          // Vision-class content gets a relevance boost for meta-vision queries
          const visionBoost = boostVision && (chunk.contentClass === "vision" || chunk.contentClass === "research") ? 0.15 : 0;
          // SOP-class content gets a boost for governance/process queries
          const isSopQuery = /(?:how does .+ work|what(?:'s| is) the process|SOP|procedure|governance|promotion|state machine)/i.test(rewrittenQuery);
          const sopBoost = isSopQuery && chunk.contentClass === "sop" ? 0.12 : 0;
          const boostedSimilarity = Math.min(1, chunk.similarity + freshnessBoost + visionBoost + sopBoost);

          sources.push({
            id: chunk.id,
            type: "repo",
            name: `${chunk.repo}/${chunk.path}`,
            display_name: `${chunk.repo}/${chunk.path}`,
            relevance: boostedSimilarity,
            freshness: computeFreshness(chunk.ingestedAt?.toISOString()),
            confidence: Math.min(1, boostedSimilarity * 0.9),
            snippet: chunk.content,
            url: `/repos/${chunk.repo}/tree/main/${chunk.path}`,
            source_type: chunk.contentClass === "vision" || chunk.contentClass === "research" ? "research_corpus" : "corpus",
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
  const federatedSources = await fetchFederatedKnowledge(rewrittenQuery, options.queryStrategy);
  sources.push(...federatedSources);

  // -------------------------------------------------------------------------
  // Strategy 6: On-demand file read (Phase 3B)
  // -------------------------------------------------------------------------
  if (isFileAccessAvailable()) {
    // Detect "show me / read / contents of <repo>/<path>" patterns
    const fileAccessMatch = rewrittenQuery.match(
      /(?:show|read|contents?\s*of|cat|display|view|open)\s+(?:(?:the\s+)?(?:file\s+)?)?(\S+\/\S+)/i
    );
    if (fileAccessMatch) {
      strategies.push("on_demand");
      const fullPath = fileAccessMatch[1];
      // Try to split into repo/path
      const slashIdx = fullPath.indexOf("/");
      if (slashIdx > 0) {
        const repoGuess = fullPath.slice(0, slashIdx);
        const pathGuess = fullPath.slice(slashIdx + 1);

        // Try exact repo name first, then fuzzy match
        const manifest = getManifest();
        const matchedRepo = manifest.repos.find(
          (r) => r.name === repoGuess || r.slug === repoGuess ||
                 r.name.includes(repoGuess) || repoGuess.includes(r.name)
        );

        if (matchedRepo) {
          const fileResult = readFile(matchedRepo.name, pathGuess);
          if (fileResult) {
            sources.push({
              id: `ondemand:${matchedRepo.name}:${pathGuess}`,
              type: "file_content",
              name: `${matchedRepo.name}/${pathGuess}`,
              display_name: `${matchedRepo.name}/${pathGuess}`,
              relevance: 0.95,
              freshness: 1.0,
              confidence: 1.0,
              snippet: fileResult.content.slice(0, 3000),
              url: `/repos/${matchedRepo.slug}`,
              source_type: "on_demand",
              retrieved_at: new Date().toISOString(),
            });

            // Phase 3D: Lazy embed into document_chunks (fire-and-forget)
            lazyEmbed(matchedRepo.name, matchedRepo.organ, pathGuess, fileResult.content).catch(() => {});
          }
        }
      }
    }

    // Also handle directory listing queries
    const dirMatch = rewrittenQuery.match(
      /(?:list|ls|files?\s+in|directory|what(?:'s| is)\s+in)\s+(?:(?:the\s+)?)?(\S+\/\S*)/i
    );
    if (dirMatch && !fileAccessMatch) {
      strategies.push("on_demand");
      const fullPath = dirMatch[1].replace(/\/$/, "");
      const slashIdx = fullPath.indexOf("/");
      const repoGuess = slashIdx > 0 ? fullPath.slice(0, slashIdx) : fullPath;
      const pathGuess = slashIdx > 0 ? fullPath.slice(slashIdx + 1) : ".";

      const manifest = getManifest();
      const matchedRepo = manifest.repos.find(
        (r) => r.name === repoGuess || r.slug === repoGuess ||
               r.name.includes(repoGuess) || repoGuess.includes(r.name)
      );

      if (matchedRepo) {
        const dirResult = listDirectory(matchedRepo.name, pathGuess);
        if (dirResult) {
          const listing = dirResult.entries
            .map((e) => `${e.type === "directory" ? "📁" : "📄"} ${e.name}${e.sizeBytes ? ` (${(e.sizeBytes / 1024).toFixed(1)}KB)` : ""}`)
            .join("\n");

          sources.push({
            id: `ondemand:dir:${matchedRepo.name}:${pathGuess}`,
            type: "file_content",
            name: `${matchedRepo.name}/${pathGuess}/`,
            display_name: `Directory: ${matchedRepo.name}/${pathGuess}/`,
            relevance: 0.9,
            freshness: 1.0,
            confidence: 1.0,
            snippet: listing,
            url: `/repos/${matchedRepo.slug}`,
            source_type: "on_demand",
            retrieved_at: new Date().toISOString(),
          });
        }
      }
    }
  }

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

  if (repo.file_index) {
    const filePathsL = repo.file_index.join(" ").toLowerCase();
    for (const term of terms) {
      if (filePathsL.includes(term)) score += 3;
    }
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

// ---------------------------------------------------------------------------
// Lazy embedding (Phase 3D)
// ---------------------------------------------------------------------------

async function lazyEmbed(repo: string, organ: string, filePath: string, content: string): Promise<void> {
  try {
    // Dynamically import to avoid circular deps in test
    const { embedChunks } = await import("./ingestion/embed");
    await embedChunks({
      repo,
      organ,
      filePath,
      content,
      fileMtime: new Date(),
    });
  } catch {
    // Fire-and-forget — silently fail
  }
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
