import { buildTier1Context, buildTier2Context } from "@/lib/retrieval";
import { hybridRetrieve } from "@/lib/hybrid-retrieval";
import { planQuery } from "@/lib/query-planner";
import { buildCitations, buildCitationInstructions, buildCitedResponse } from "@/lib/citations";
import { maskPii, buildAccessContext, logAudit } from "@/lib/security";
import { getManifest } from "@/lib/manifest";
import { getPlatformConfig } from "@/lib/platform-config";
import { incrementCounter, recordTiming, withTimingAsync } from "@/lib/observability";
import { getPersonaConfig } from "@/lib/personas";
import type { PersonaId } from "@/lib/personas";
import { getAdminSessionFromRequest } from "@/lib/admin-auth";
import type { Repo } from "@/lib/types";
import type { Citation } from "@/lib/citations";
import type { QueryPlan } from "@/lib/query-planner";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// Simple in-memory rate limiter: 10 req/min per IP
type RateLimitEntry = {
  timestamps: number[];
  lastSeen: number;
};

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_KEYS = 5_000;
const TRUST_PROXY_IP_HEADERS = process.env.TRUST_PROXY_IP_HEADERS === "1";
const EDGE_RATE_LIMIT_ENABLED = process.env.EDGE_RATE_LIMIT_ENABLED === "1";
const EDGE_BLOCK_HEADER = process.env.EDGE_BLOCK_HEADER || "x-edge-rate-limit-blocked";
const EDGE_REMAINING_HEADER = process.env.EDGE_REMAINING_HEADER || "x-ratelimit-remaining";
const EDGE_RETRY_AFTER_HEADER = process.env.EDGE_RETRY_AFTER_HEADER || "retry-after";
const MAX_MESSAGE_COUNT = 10;
const MAX_MESSAGE_CHARS = 4_000;
const DEFAULT_GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_OSS_LLM_API_URL = "https://text.pollinations.ai/openai";
const DEFAULT_OSS_LLM_MODEL = "openai-fast";
const CHAT_DIAGNOSTICS_ENABLED = getPlatformConfig().observability.diagnostics_enabled;
const manifest = getManifest();

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

interface ChatDiagnostics {
  persona: PersonaId;
  path: "deterministic" | "live_research_blocked" | "hybrid_retrieval" | "offline_fallback" | "insufficient_evidence";
  planner: {
    strategy: string;
    answerability: QueryPlan["answerability"];
    reason: string;
    target_repos: number;
    target_organs: number;
    sub_queries: number;
  };
  retrieval?: {
    strategy: string;
    source_count: number;
    total_candidates: number;
  };
  provider?: {
    name: string;
    status: "success" | "error" | "skipped";
    reason?: string;
  };
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function scoreRepoHint(repo: Repo, hint: string): number {
  const normalizedHint = normalizeText(hint);
  const slug = normalizeText(repo.slug);
  const name = normalizeText(repo.name);
  const display = normalizeText(repo.display_name);
  let score = 0;

  if (slug === normalizedHint || name === normalizedHint || display === normalizedHint) {
    score += 100;
  }
  if (slug.includes(normalizedHint) || name.includes(normalizedHint) || display.includes(normalizedHint)) {
    score += 60;
  }

  const tokens = normalizedHint.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (slug.includes(token)) score += 10;
    if (name.includes(token)) score += 10;
    if (display.includes(token)) score += 8;
    if (normalizeText(repo.description).includes(token)) score += 3;
    if (normalizeText(repo.ai_context).includes(token)) score += 1;
  }

  if (repo.file_index) {
    for (const filePath of repo.file_index) {
      if (normalizeText(filePath).includes(normalizedHint)) {
        score += 5;
        break;
      }
    }
    for (const token of tokens) {
      if (repo.file_index.some((f) => normalizeText(f).includes(token))) {
        score += 2;
      }
    }
  }

  return score;
}


function listTopRepoSuggestions(hint: string, count = 3): Repo[] {
  return manifest.repos
    .map((repo) => ({ repo, score: scoreRepoHint(repo, hint) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((s) => s.repo);
}


function getFreshnessLabel(freshness: number): Citation["freshness_label"] {
  if (freshness >= 0.95) return "live";
  if (freshness >= 0.8) return "fresh";
  if (freshness >= 0.5) return "recent";
  if (freshness >= 0.3) return "aged";
  return "stale";
}

function computeFreshnessScore(timestamp: string | null | undefined): number {
  if (!timestamp) return 0.3;
  const parsedMs = Date.parse(timestamp);
  if (!Number.isFinite(parsedMs)) return 0.3;

  const ageHours = Math.max(0, (Date.now() - parsedMs) / (1000 * 60 * 60));
  if (ageHours <= 1) return 0.98;
  if (ageHours <= 24) return 0.9;
  if (ageHours <= 24 * 7) return 0.75;
  if (ageHours <= 24 * 30) return 0.55;
  return 0.35;
}

function buildManifestSnapshotCitation(): Citation {
  const retrievedAt = new Date().toISOString();
  const generatedAt = typeof manifest.generated === "string" ? manifest.generated : null;
  const freshness = computeFreshnessScore(generatedAt);

  return {
    id: "cite-1",
    source_name: "ORGANVM Manifest Snapshot",
    source_type: "manifest",
    url: null,
    relevance: 1,
    confidence: 0.92,
    freshness,
    freshness_label: getFreshnessLabel(freshness),
    snippet: `Snapshot generated ${generatedAt ?? "unknown"} covering ${manifest.system.total_repos} repos and ${manifest.system.total_organs} organs.`,
    retrieved_at: retrievedAt,
  };
}

function buildInsufficientEvidenceResponse(queryText: string, reason: string): string {
  const query = queryText.trim() || "this request";
  return [
    "### Insufficient Evidence for Full Answer",
    `I cannot fully answer **${query}** using the current authorized context.`,
    `Reason: ${reason}.`,
    "I can still provide a snapshot-only answer if you want an internal-only approximation.",
  ].join("\n\n");
}

function buildDiagnostics(
  queryPlan: QueryPlan,
  path: ChatDiagnostics["path"],
  partial?: Omit<ChatDiagnostics, "path" | "planner" | "persona">,
  personaId: PersonaId = "hermeneus"
): ChatDiagnostics | undefined {
  if (!CHAT_DIAGNOSTICS_ENABLED) return undefined;
  return {
    persona: personaId,
    path,
    planner: {
      strategy: queryPlan.strategy,
      answerability: queryPlan.answerability,
      reason: queryPlan.answerability_reason,
      target_repos: queryPlan.target_repos.length,
      target_organs: queryPlan.target_organs.length,
      sub_queries: queryPlan.sub_queries.length,
    },
    ...partial,
  };
}

function createSseResponse(
  text: string,
  citations?: Citation[],
  meta?: {
    confidence?: number;
    coverage?: number;
    strategy?: string;
    suggestions?: string[];
    answerability?: "answerable" | "partial" | "unanswerable";
    answerability_reason?: string;
    diagnostics?: ChatDiagnostics;
  }
): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
      );
      if ((citations && citations.length > 0) || meta) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            citations: citations ?? [],
            confidence_score: meta?.confidence ?? 0,
            citation_coverage: meta?.coverage ?? 0,
            strategy: meta?.strategy ?? "unknown",
            suggestions: meta?.suggestions ?? [],
            answerability: meta?.answerability ?? "answerable",
            answerability_reason: meta?.answerability_reason ?? "",
            diagnostics: meta?.diagnostics,
          })}\n\n`)
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function trackChatPath(path: string, startedAtMs: number): void {
  incrementCounter("chat.path_total", 1, { path });
  recordTiming("chat.request_duration_ms", Date.now() - startedAtMs, { path });
}

function buildOfflineResponse(
  queryText: string,
  _tier1: string,
  _tier2: string,
  reason?: string,
  sources?: Array<{ name: string; display_name: string; relevance: number; freshness: number; snippet: string; url?: string | null; source_type?: string }>
): string {
  const query = queryText.trim() || "the ORGANVM system";
  if (reason) console.warn("[chat] offline fallback:", reason);

  const lines: string[] = [
    `### Unable to Reach AI Model`,
    `I could not reach the language model to synthesize an answer for **${query}**. Here is what I found in the knowledge base:`,
  ];

  if (sources && sources.length > 0) {
    lines.push("", "#### Retrieved Evidence");
    for (const src of sources.slice(0, 8)) {
      const relevancePct = Math.round(src.relevance * 100);
      const freshnessLabel = src.freshness >= 0.8 ? "fresh" : src.freshness >= 0.5 ? "recent" : "aged";
      const snippet = src.snippet.length > 250 ? src.snippet.slice(0, 250) + "..." : src.snippet;
      const link = src.url ? ` [source](${src.url})` : "";
      lines.push(`- **${src.display_name}** (${relevancePct}% relevant, ${freshnessLabel})${link}`);
      lines.push(`  > ${snippet}`);
    }
    lines.push("", "*These sources were retrieved successfully before the model failure. You can retry for a synthesized answer.*");
  } else {
    lines.push("", "No relevant sources were retrieved for this query.");
  }

  return lines.join("\n");
}

type OpenAICompatibleMessage = {
  role: "assistant";
  content?: string | Array<{ type?: string; text?: string }>;
};

type OpenAICompatibleResponse = {
  choices?: Array<{ message?: OpenAICompatibleMessage }>;
  error?: { message?: string };
};

type ProviderConfig = {
  apiUrl: string;
  model: string;
  apiKey?: string;
  providerName: string;
};

function getProviderConfig(): ProviderConfig {
  // allow-secret: env lookup only, no hardcoded credential.
  const groqApiKey = process.env.GROQ_API_KEY;
  if (groqApiKey) {
    return {
      apiUrl: process.env.GROQ_API_URL || DEFAULT_GROQ_API_URL,
      model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      apiKey: groqApiKey, // allow-secret: env-derived token pass-through.
      providerName: "Groq",
    };
  }

  return {
    // allow-secret: optional env lookup for provider token.
    apiUrl: process.env.OSS_LLM_API_URL || DEFAULT_OSS_LLM_API_URL,
    model: process.env.OSS_LLM_MODEL || DEFAULT_OSS_LLM_MODEL,
    apiKey: process.env.OSS_LLM_API_KEY, // allow-secret: env-derived token pass-through.
    providerName: "anonymous OSS fallback",
  };
}

function extractProviderText(data: OpenAICompatibleResponse): string | null {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return null;
}

type ModelResponse =
  | { mode: "buffered"; text: string; providerName: string }
  | { mode: "streaming"; stream: ReadableStream<Uint8Array>; providerName: string };

/**
 * Issue #3: Scale timeout by query complexity.
 * Issue #5: Request with stream:true. If provider returns SSE, stream it.
 *           If provider returns JSON (no SSE support), parse it as buffered.
 *           Single fetch call — no double-request.
 */
async function generateModelResponse(
  messages: ChatMessage[],
  systemPrompt: string,
  modelConfig?: { temperature?: number; max_tokens?: number },
  estimatedCost?: number
): Promise<ModelResponse> {
  const provider = getProviderConfig();

  const timeoutMs = Math.min(60_000, 15_000 + (estimatedCost ?? 5) * 3_000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await withTimingAsync(
      "chat.provider_request_ms",
      () =>
        fetch(provider.apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: provider.model,
            stream: true,
            temperature: modelConfig?.temperature ?? 0.2,
            max_tokens: modelConfig?.max_tokens ?? 1200,
            messages: [{ role: "system", content: systemPrompt }, ...messages],
          }),
          signal: controller.signal,
        }),
      { provider: provider.providerName }
    );

    if (!response.ok) {
      incrementCounter("chat.provider_error_total", 1, {
        provider: provider.providerName,
        status: response.status,
      });
      const errorBody = (await response.text()).slice(0, 350);
      throw new Error(`${provider.providerName} HTTP ${response.status}: ${errorBody}`);
    }

    // Check if provider returned SSE stream or buffered JSON
    const contentType = response.headers.get("content-type") || "";
    const isSSE = contentType.includes("text/event-stream") || contentType.includes("text/plain");

    if (isSSE && response.body) {
      // Stream path: forward SSE deltas as our own SSE chunks
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const reader = response.body.getReader();

      const readable = new ReadableStream<Uint8Array>({
        async pull(streamController) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(timeoutId);
              incrementCounter("chat.provider_success_total", 1, { provider: provider.providerName });
              streamController.close();
              return;
            }
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  streamController.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ text: content })}\n\n`)
                  );
                }
              } catch { /* skip malformed SSE chunks */ }
            }
          } catch (err) {
            clearTimeout(timeoutId);
            streamController.error(err);
          }
        },
        cancel() {
          clearTimeout(timeoutId);
          controller.abort();
          reader.cancel().catch(() => {});
        },
      });

      return { mode: "streaming", stream: readable, providerName: provider.providerName };
    }

    // Buffered path: parse JSON response
    const data = (await response.json()) as OpenAICompatibleResponse;
    const text = extractProviderText(data);
    if (text) {
      incrementCounter("chat.provider_success_total", 1, { provider: provider.providerName });
      return { mode: "buffered", text, providerName: provider.providerName };
    }
    if (data.error?.message) throw new Error(data.error.message);
    throw new Error("OSS provider returned no assistant text.");
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseForwardedIp(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildAnonymousClientKey(request: Request): string {
  const ua = request.headers.get("user-agent") || "";
  const accept = request.headers.get("accept") || "";
  const lang = request.headers.get("accept-language") || "";
  return `anon:${hashString(`${ua}|${accept}|${lang}`)}`;
}

function getTrustedProxyIp(request: Request): string | null {
  if (request.headers.has("cf-ray")) {
    return parseForwardedIp(request.headers.get("cf-connecting-ip"));
  }
  if (request.headers.has("x-vercel-id")) {
    return parseForwardedIp(request.headers.get("x-forwarded-for"));
  }
  if (TRUST_PROXY_IP_HEADERS) {
    return (
      parseForwardedIp(request.headers.get("x-forwarded-for")) ||
      parseForwardedIp(request.headers.get("x-real-ip")) ||
      parseForwardedIp(request.headers.get("cf-connecting-ip"))
    );
  }
  return null;
}

function getClientKey(request: Request): string {
  const trustedIp = getTrustedProxyIp(request);
  if (trustedIp) return `ip:${trustedIp}`;
  return buildAnonymousClientKey(request);
}

function getEdgeRateLimitDecision(request: Request): {
  limited: boolean;
  retryAfter: string | null;
} {
  if (!EDGE_RATE_LIMIT_ENABLED) return { limited: false, retryAfter: null };

  const blocked = request.headers.get(EDGE_BLOCK_HEADER);
  if (blocked === "1" || blocked?.toLowerCase() === "true") {
    return {
      limited: true,
      retryAfter: request.headers.get(EDGE_RETRY_AFTER_HEADER),
    };
  }

  const remaining = Number(request.headers.get(EDGE_REMAINING_HEADER));
  if (Number.isFinite(remaining) && remaining <= 0) {
    return {
      limited: true,
      retryAfter: request.headers.get(EDGE_RETRY_AFTER_HEADER),
    };
  }

  return { limited: false, retryAfter: null };
}

function evictOldestRateLimitKeys(targetSize: number): void {
  if (rateLimitMap.size <= targetSize) return;
  const keysByLastSeen = [...rateLimitMap.entries()]
    .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
    .map(([key]) => key);
  const removeCount = rateLimitMap.size - targetSize;
  for (let i = 0; i < removeCount; i += 1) {
    const key = keysByLastSeen[i];
    if (key) rateLimitMap.delete(key);
  }
}

function cleanupRateLimitMap(now: number): void {
  for (const [clientKey, entry] of rateLimitMap.entries()) {
    const recent = entry.timestamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length > 0) {
      rateLimitMap.set(clientKey, { timestamps: recent, lastSeen: entry.lastSeen });
    } else {
      rateLimitMap.delete(clientKey);
    }
  }
  evictOldestRateLimitKeys(MAX_RATE_LIMIT_KEYS);
}

function isRateLimited(clientKey: string): boolean {
  const now = Date.now();
  cleanupRateLimitMap(now);

  const current = rateLimitMap.get(clientKey) || { timestamps: [], lastSeen: now };
  if (current.timestamps.length >= RATE_LIMIT) return true;

  current.timestamps.push(now);
  current.lastSeen = now;
  rateLimitMap.set(clientKey, current);
  return false;
}

function rateLimitResponse(retryAfter: string | null = null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (retryAfter) headers["Retry-After"] = retryAfter;
  return new Response(
    JSON.stringify({ error: "Rate limited. Try again in a minute." }),
    { status: 429, headers }
  );
}

export async function POST(request: Request) {
  const requestStartedAtMs = Date.now();
  incrementCounter("chat.requests_total");

  const edgeDecision = getEdgeRateLimitDecision(request);
  if (edgeDecision.limited) {
    incrementCounter("chat.rate_limited_total", 1, { type: "edge" });
    trackChatPath("edge_rate_limited", requestStartedAtMs);
    return rateLimitResponse(edgeDecision.retryAfter);
  }

  const clientKey = getClientKey(request);
  if (isRateLimited(clientKey)) {
    incrementCounter("chat.rate_limited_total", 1, { type: "local" });
    trackChatPath("local_rate_limited", requestStartedAtMs);
    return rateLimitResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    incrementCounter("chat.bad_request_total", 1, { reason: "invalid_json" });
    trackChatPath("invalid_json", requestStartedAtMs);
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse persona mode and audience lens
  const rawMode =
    typeof body === "object" && body !== null && "mode" in body
      ? (body as { mode?: unknown }).mode
      : undefined;
  const personaId: PersonaId = rawMode === "advisor" ? "advisor" : "hermeneus";
  const persona = getPersonaConfig(personaId);

  const rawLens =
    typeof body === "object" && body !== null && "lens" in body
      ? (body as { lens?: unknown }).lens
      : undefined;
  const lens = typeof rawLens === "string" ? rawLens : undefined;

  // Auth gate for advisor mode
  if (persona.requiresAuth) {
    const session = getAdminSessionFromRequest(request);
    const tokenHeader = request.headers.get("x-admin-token")?.trim();
    const expectedToken = process.env.ADMIN_API_TOKEN; // allow-secret: env lookup only
    const hasValidToken = !!(expectedToken && tokenHeader && tokenHeader === expectedToken);

    if (!session && !hasValidToken) {
      incrementCounter("chat.advisor_unauthorized_total");
      trackChatPath("advisor_unauthorized", requestStartedAtMs);
      return new Response(
        JSON.stringify({ error: "Advisor mode requires admin authentication" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  const rawMessages =
    typeof body === "object" && body !== null && "messages" in body
      ? (body as { messages?: unknown }).messages
      : undefined;

  const messages: ChatMessage[] = Array.isArray(rawMessages)
    ? rawMessages
        .filter((m): m is ChatMessage => {
          if (typeof m !== "object" || m === null) return false;
          const candidate = m as { role?: unknown; content?: unknown };
          return (
            (candidate.role === "user" || candidate.role === "assistant") &&
            typeof candidate.content === "string"
          );
        })
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, MAX_MESSAGE_CHARS),
        }))
        .slice(-MAX_MESSAGE_COUNT)
    : [];

  if (!messages.length) {
    incrementCounter("chat.bad_request_total", 1, { reason: "no_messages" });
    trackChatPath("no_messages", requestStartedAtMs);
    return new Response(
      JSON.stringify({ error: "No messages provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Extract the latest user query for retrieval
  const lastUserMessage = messages
    .filter((m) => m.role === "user")
    .pop();
  const queryText =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : "";

  // Security: mask PII in query
  const sanitizedQuery = maskPii(queryText);

  // Audit log
  const accessCtx = buildAccessContext(request);
  logAudit("chat_query", "chat", accessCtx, true, "Query accepted", {
    query_length: sanitizedQuery.length,
  });

  // Query planning
  const queryPlan = planQuery(sanitizedQuery);

  // Build context (legacy tier system for fallback)
  const tier1 = buildTier1Context();
  const tier2 = buildTier2Context(sanitizedQuery);

  // All queries go through the LLM with retrieved context — no canned responses.

  // Avoid pretending live web/news retrieval exists when only snapshot data is available.
  if (queryPlan.strategy === "live_research") {
    const snapshotCitation = buildManifestSnapshotCitation();
    trackChatPath("live_research_blocked", requestStartedAtMs);
    return createSseResponse([
      "### Live Research Query Detected",
      "This endpoint cannot currently perform real-time external retrieval (web/news/market APIs).",
      "I can answer from the current ORGANVM snapshot only. To support this query class, wire external connectors into ingestion and schedule incremental sync.",
    ].join("\n\n"), [snapshotCitation], {
      confidence: 0.35,
      coverage: 0.4,
      strategy: "live_research",
      suggestions: queryPlan.suggested_followups,
      answerability: queryPlan.answerability,
      answerability_reason: queryPlan.answerability_reason,
      diagnostics: buildDiagnostics(queryPlan, "live_research_blocked", {
        provider: { name: "none", status: "skipped" },
      }, personaId),
    });
  }

  // --------------------------------------------------------------------------
  // Phase 3: Analytics Queries (Word/Phrase Frequencies via Postgres)
  // --------------------------------------------------------------------------
  if (queryPlan.strategy === "analytics") {
    trackChatPath("analytics", requestStartedAtMs);
    try {
      const results = await db.execute(
        sql`SELECT word, ndoc, nentry FROM ts_stat('SELECT search_vector FROM document_chunks') ORDER BY nentry DESC LIMIT 15`
      );

      const rows = Array.isArray(results.rows)
        ? (results.rows as Record<string, unknown>[])
        : (results as unknown as Record<string, unknown>[]);

      const wordsMarkdown = rows
        .map((row) => `- **${String(row.word)}**: ${Number(row.nentry)} occurrences (in ${Number(row.ndoc)} docs)`)
        .join("\n");

      // We bypass the LLM and return the raw aggregations instantly
      const answer = `### Corpus Analytical Aggregations\n\nI ran a high-speed system-wide statistical aggregation over the ingested textual chunks across the active corpus. Here are the most frequent words/phrases:\n\n${wordsMarkdown}\n\n*(Note: This is deterministic corpus analysis querying directly against the vector/text index, bypassing the contextual limit).*`;

      const snapshotCitation = buildManifestSnapshotCitation();

      return createSseResponse(answer, [snapshotCitation], {
        confidence: 0.95,
        coverage: 1.0,
        strategy: "analytics",
        suggestions: ["Narrow frequency by repo", "Extract specific phrases instead"],
        answerability: "answerable",
        answerability_reason: "Executed direct database statistical aggregation",
        diagnostics: buildDiagnostics(queryPlan, "hybrid_retrieval", {
          provider: { name: "none", status: "success" },
        }, personaId),
      });
    } catch (e) {
      console.error("Failed to execute analytics strategy:", e);
      // Fall through to hybrid search if analytics query dynamically fails
    }
  }

  // Hybrid retrieval — scope source count by strategy (issue #6: prompt size reduction)
  const narrowStrategies = new Set(["single_repo", "file_access", "deterministic"]);
  const maxSources = queryPlan.strategy === "meta_vision" ? 15
    : narrowStrategies.has(queryPlan.strategy) ? 5
    : queryPlan.strategy === "organ_scope" ? 8
    : 10;
  const retrieval = await hybridRetrieve(sanitizedQuery, {
    maxSources,
    includeGraph: queryPlan.strategy === "graph_traversal" || queryPlan.strategy === "cross_organ",
    boostVision: queryPlan.strategy === "meta_vision",
    queryStrategy: queryPlan.strategy,
  });

  const citations = buildCitations(retrieval.sources);
  const citationInstructions = buildCitationInstructions(citations);
  const hasStrongSources = citations.some((c) => c.relevance > 0.5);

  // When context is thin, append closest-match repo hints so the LLM can offer something useful
  let closestMatchHint = "";
  if (!hasStrongSources) {
    const suggestions = listTopRepoSuggestions(sanitizedQuery, 5);
    if (suggestions.length > 0) {
      closestMatchHint = `\n\n=== CLOSEST MATCHING REPOS ===\nNo strong match was found. These repos had the highest relevance to the query:\n` +
        suggestions.map((r) => `- ${r.display_name} (${r.name}) — ${r.organ}: ${r.description.slice(0, 150)}`).join("\n") +
        `\nMention these as possible matches if the user may be referring to one of them.`;
    }
  }
  // Issue #6: omit tier1 system overview for narrow queries to save ~500 tokens
  const includeTier1 = !narrowStrategies.has(queryPlan.strategy);
  const systemPrompt = persona.buildSystemPrompt({
    citationInstructions,
    tier1: includeTier1 ? retrieval.tier1 : "",
    context: retrieval.context,
    closestMatchHint,
    totalRepos: manifest.system.total_repos,
    totalOrgans: manifest.system.total_organs,
    lens,
    queryStrategy: queryPlan.strategy,
  });

  try {
    const providerResponse = await generateModelResponse(messages, systemPrompt, persona.modelConfig, queryPlan.estimated_cost);
    const retrievalDiag = {
      strategy: retrieval.strategy,
      source_count: retrieval.sources.length,
      total_candidates: retrieval.total_candidates,
    };

    // Issue #5: If provider returned SSE stream, forward it with citation meta appended
    if (providerResponse.mode === "streaming") {
      trackChatPath("hybrid_retrieval", requestStartedAtMs);
      const encoder = new TextEncoder();
      const metaChunk = JSON.stringify({
        citations: citations.map((c) => ({
          id: c.id, source_name: c.source_name, source_type: c.source_type,
          url: c.url, relevance: c.relevance, freshness_label: c.freshness_label, snippet: c.snippet,
        })),
        confidence_score: citations.length > 0 ? citations.reduce((s, c) => s + c.relevance, 0) / citations.length : 0,
        citation_coverage: hasStrongSources ? 0.7 : 0.3,
        strategy: retrieval.strategy,
        suggestions: queryPlan.suggested_followups,
        answerability: queryPlan.answerability,
        answerability_reason: queryPlan.answerability_reason,
        diagnostics: buildDiagnostics(queryPlan, "hybrid_retrieval", {
          retrieval: retrievalDiag,
          provider: { name: providerResponse.providerName, status: "success" },
        }, personaId),
      });

      const composedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const reader = providerResponse.stream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } catch (streamErr) {
            const errMsg = streamErr instanceof Error ? streamErr.message : "Stream error";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${metaChunk}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(composedStream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
      });
    }

    // Buffered path: process as before
    const responseText = providerResponse.text;
    const cited = buildCitedResponse(responseText, retrieval.sources);

    // Graduated evidence gate
    if (queryPlan.answerability === "unanswerable" && retrieval.sources.length === 0 && cited.has_unsupported_claims) {
      trackChatPath("insufficient_evidence", requestStartedAtMs);
      return createSseResponse(
        buildInsufficientEvidenceResponse(sanitizedQuery, queryPlan.answerability_reason),
        cited.citations,
        {
          confidence: Math.min(0.45, cited.confidence_score),
          coverage: cited.citation_coverage,
          strategy: retrieval.strategy,
          suggestions: queryPlan.suggested_followups,
          answerability: queryPlan.answerability,
          answerability_reason: queryPlan.answerability_reason,
          diagnostics: buildDiagnostics(queryPlan, "insufficient_evidence", {
            retrieval: retrievalDiag,
            provider: { name: providerResponse.providerName, status: "success" },
          }, personaId),
        }
      );
    }

    let finalResponseText = responseText;
    if (queryPlan.answerability !== "answerable" && cited.has_unsupported_claims) {
      finalResponseText += "\n\n---\n*Note: Some claims in this response could not be verified against indexed sources. Treat unverified details with appropriate caution.*";
    }
    trackChatPath("hybrid_retrieval", requestStartedAtMs);
    return createSseResponse(
      maskPii(finalResponseText),
      cited.citations,
      {
        confidence: cited.confidence_score,
        coverage: cited.citation_coverage,
        strategy: retrieval.strategy,
        suggestions: queryPlan.suggested_followups,
        answerability: queryPlan.answerability,
        answerability_reason: queryPlan.answerability_reason,
        diagnostics: buildDiagnostics(queryPlan, "hybrid_retrieval", {
          retrieval: retrievalDiag,
          provider: { name: providerResponse.providerName, status: "success" },
        }, personaId),
      }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown provider error";
    trackChatPath("offline_fallback", requestStartedAtMs);
    return createSseResponse(buildOfflineResponse(sanitizedQuery, tier1, tier2, reason, retrieval.sources), citations, {
      strategy: "offline_fallback",
      suggestions: queryPlan.suggested_followups,
      answerability: queryPlan.answerability,
      answerability_reason: queryPlan.answerability_reason,
      diagnostics: buildDiagnostics(queryPlan, "offline_fallback", {
        retrieval: {
          strategy: retrieval.strategy,
          source_count: retrieval.sources.length,
          total_candidates: retrieval.total_candidates,
        },
        provider: { name: "unknown", status: "error", reason },
      }, personaId),
    });
  }
}
