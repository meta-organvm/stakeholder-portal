/**
 * Knowledge API — shared knowledge body for external consumers.
 *
 * GET /api/knowledge/organs  — structured organ data from manifest
 * GET /api/knowledge/context — query planner + hybrid retrieval (no LLM)
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgansForAPI } from "@/lib/manifest";
import { planQuery } from "@/lib/query-planner";
import { hybridRetrieve } from "@/lib/hybrid-retrieval";
import { buildCitations } from "@/lib/citations";
import { getPrismFacets } from "@/lib/public-exposure-policy";

const ALLOWED_ORIGINS = [
  "https://4444j99.github.io",
  "https://organvm-i-theoria.github.io",
  "http://localhost:4321",
  "http://localhost:3000",
  "http://127.0.0.1:4321",
];

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Knowledge-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("Origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(origin);
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint") || "organs";

  if (endpoint === "prism") {
    return NextResponse.json(
      {
        ok: true,
        facets: getPrismFacets(),
      },
      { headers },
    );
  }

  if (endpoint === "organs") {
    const organs = getOrgansForAPI();
    return NextResponse.json({ ok: true, organs }, { headers });
  }

  if (endpoint === "context") {
    const query = searchParams.get("q");
    if (!query || query.trim().length < 3) {
      return NextResponse.json(
        { ok: false, error: "Query parameter 'q' is required (min 3 chars)" },
        { status: 400, headers },
      );
    }

    const limitParam = parseInt(searchParams.get("limit") || "5", 10);
    const limit = Math.min(Math.max(1, limitParam), 20);

    const plan = planQuery(query);
    const retrieval = await hybridRetrieve(query, {
      maxSources: limit,
      includeGraph: plan.strategy === "graph_traversal" || plan.strategy === "cross_organ",
      boostVision: plan.strategy === "meta_vision",
    });

    const citations = buildCitations(retrieval.sources);

    return NextResponse.json(
      {
        ok: true,
        query,
        strategy: plan.strategy,
        answerability: plan.answerability,
        sources: retrieval.sources.slice(0, limit).map((s) => ({
          id: s.id,
          type: s.type,
          name: s.name,
          display_name: s.display_name,
          relevance: s.relevance,
          confidence: s.confidence,
          snippet: s.snippet.slice(0, 500),
          url: s.url,
          source_type: s.source_type,
        })),
        citations: citations.slice(0, limit),
        total_candidates: retrieval.total_candidates,
      },
      { headers },
    );
  }

  return NextResponse.json(
    { ok: false, error: "Unknown endpoint. Use ?endpoint=organs or ?endpoint=context&q=..." },
    { status: 400, headers },
  );
}
