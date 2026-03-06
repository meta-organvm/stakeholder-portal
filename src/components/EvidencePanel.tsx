"use client";

import React, { useState } from "react";

export interface EvidenceCitation {
  id: string;
  source_name: string;
  source_type: string;
  url: string | null;
  relevance: number;
  confidence: number;
  freshness: number;
  freshness_label: "live" | "fresh" | "recent" | "aged" | "stale";
  snippet: string;
}

interface EvidencePanelProps {
  citations: EvidenceCitation[];
  confidence_score: number;
  citation_coverage: number;
}

const FRESHNESS_COLORS: Record<string, string> = {
  live: "text-green-400",
  fresh: "text-green-300",
  recent: "text-yellow-300",
  aged: "text-orange-300",
  stale: "text-red-300",
};

export function EvidencePanel({
  citations,
  confidence_score,
  citation_coverage,
}: EvidencePanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (citations.length === 0) return null;

  const topCitations = expanded ? citations : citations.slice(0, 3);

  return (
    <div className="evidence-panel-root">
      {/* Header bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-xs text-[var(--color-text-muted)]"
      >
        <span className="font-medium">
          Sources ({citations.length}) | Confidence:{" "}
          {(confidence_score * 100).toFixed(0)}% | Coverage:{" "}
          {(citation_coverage * 100).toFixed(0)}%
        </span>
        <span className="text-[var(--color-accent-bright)] font-medium">
          {expanded ? "Collapse" : "Expand"}
        </span>
      </button>

      {/* Citation list */}
      <div className="mt-2 space-y-2 px-3 pb-3">
        {topCitations.map((c) => (
          <div
            key={c.id}
            className="source-card text-xs transition-colors hover:border-[rgba(255,255,255,0.12)]"
          >
            <div className="flex items-center justify-between">
              <span className="cite-pill">
                [{c.id}]
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`font-semibold uppercase tracking-wider text-[0.65rem] px-1.5 py-0.5 rounded-full border border-[rgba(52,211,153,0.25)] bg-[var(--color-fresh-dim)] ${FRESHNESS_COLORS[c.freshness_label] || ""}`}
                >
                  {c.freshness_label}
                </span>
                <span className="text-[var(--color-text-muted)] font-medium tabular-nums">
                  {(c.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="mt-1 flex items-center">
              {c.url ? (
                <a
                  href={c.url}
                  className="text-[var(--color-accent-bright)] hover:underline font-medium"
                >
                  {c.source_name}
                </a>
              ) : (
                <span className="text-[var(--color-text)] font-medium">{c.source_name}</span>
              )}
              <span className="ml-2 text-[var(--color-text-dim)] italic text-[0.65rem]">
                ({c.source_type})
              </span>
            </div>
            {expanded && c.snippet && (
              <p className="mt-1 text-[var(--color-text-secondary)] line-clamp-2">
                {c.snippet}
              </p>
            )}
          </div>
        ))}
        {!expanded && citations.length > 3 && (
          <button
            onClick={() => setExpanded(true)}
            className="mt-1 text-[var(--color-accent-bright)] hover:underline font-medium text-xs bg-none border-none cursor-pointer"
          >
            +{citations.length - 3} more sources
          </button>
        )}
      </div>
    </div>
  );
}
