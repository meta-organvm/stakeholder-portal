"use client";

import React, { useState } from "react";

type FeedbackSignal = "correct" | "missing" | "irrelevant" | "unsafe";

interface FeedbackActionsProps {
  query: string;
  responseText: string;
  citationIds?: string[];
  strategy?: string;
  answerability?: "answerable" | "partial" | "unanswerable";
  answerabilityReason?: string;
  suggestions?: string[];
  onFeedbackSubmitted?: (signal: FeedbackSignal) => void;
}

const FEEDBACK_OPTIONS: Array<{
  signal: FeedbackSignal;
  label: string;
  icon: string;
}> = [
  { signal: "correct", label: "Helpful", icon: "+" },
  { signal: "missing", label: "Missing info", icon: "?" },
  { signal: "irrelevant", label: "Not relevant", icon: "-" },
  { signal: "unsafe", label: "Unsafe", icon: "!" },
];

export function FeedbackActions({
  query,
  responseText,
  citationIds = [],
  strategy,
  answerability,
  answerabilityReason,
  suggestions = [],
  onFeedbackSubmitted,
}: FeedbackActionsProps) {
  const [submitted, setSubmitted] = useState<FeedbackSignal | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleFeedback(signal: FeedbackSignal) {
    if (submitted || submitting) return;
    setSubmitting(true);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          response_text: responseText.slice(0, 2000),
          signal,
          citation_ids: citationIds,
          strategy,
          answerability,
          answerability_reason: answerabilityReason,
          suggestions,
        }),
      });
      if (!response.ok) return;
      setSubmitted(signal);
      onFeedbackSubmitted?.(signal);
    } catch {
      // Silently fail — feedback is best-effort
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="mt-2 text-xs text-[var(--color-text-muted)]">
        Feedback recorded: {FEEDBACK_OPTIONS.find((o) => o.signal === submitted)?.label}
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border)] pt-3 select-none">
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-dim)] mr-1">
        Validation Signal:
      </span>
      <div className="flex items-center gap-1.5">
        {FEEDBACK_OPTIONS.map((opt) => (
          <button
            key={opt.signal}
            id={`feedback-${opt.signal}`}
            onClick={() => handleFeedback(opt.signal)}
            disabled={submitting}
            title={opt.label}
            className="rounded-md border border-[var(--color-border)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-all hover:border-[var(--color-accent-bright)] hover:text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.08)] disabled:opacity-50 flex items-center gap-1.5"
          >
            <span className="text-[var(--color-accent-bright)] opacity-70">{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
