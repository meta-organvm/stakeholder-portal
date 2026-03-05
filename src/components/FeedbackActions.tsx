"use client";

import { useState } from "react";

type FeedbackSignal = "correct" | "missing" | "irrelevant" | "unsafe";

interface FeedbackActionsProps {
  query: string;
  responseText: string;
  citationIds?: string[];
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
    <div className="mt-2 flex items-center gap-1">
      <span className="text-xs text-[var(--color-text-muted)] mr-1">
        Was this helpful?
      </span>
      {FEEDBACK_OPTIONS.map((opt) => (
        <button
          key={opt.signal}
          onClick={() => handleFeedback(opt.signal)}
          disabled={submitting}
          title={opt.label}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
        >
          {opt.icon} {opt.label}
        </button>
      ))}
    </div>
  );
}
