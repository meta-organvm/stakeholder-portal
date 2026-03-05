/**
 * Feedback Capture System
 *
 * Collects user feedback on responses for continuous improvement.
 * Supports: correct, missing, irrelevant, unsafe signals.
 */

// ---------------------------------------------------------------------------
// Feedback types
// ---------------------------------------------------------------------------

export type FeedbackSignal = "correct" | "missing" | "irrelevant" | "unsafe";

export interface FeedbackEntry {
  id: string;
  query: string;
  response_text: string;
  signal: FeedbackSignal;
  comment: string | null;
  citation_ids: string[];      // which citations were relevant
  created_at: string;
  client_id: string;           // anonymized
}

export interface FeedbackStats {
  total: number;
  by_signal: Record<FeedbackSignal, number>;
  satisfaction_rate: number;   // correct / total
  last_feedback: string | null;
}

// ---------------------------------------------------------------------------
// In-memory feedback store
// ---------------------------------------------------------------------------

const feedbackStore: FeedbackEntry[] = [];
let feedbackCounter = 0;

export function submitFeedback(
  query: string,
  responseText: string,
  signal: FeedbackSignal,
  comment: string | null = null,
  citationIds: string[] = [],
  clientId = "anonymous"
): FeedbackEntry {
  feedbackCounter += 1;
  const entry: FeedbackEntry = {
    id: `fb-${feedbackCounter}`,
    query,
    response_text: responseText.slice(0, 2000),
    signal,
    comment,
    citation_ids: citationIds,
    created_at: new Date().toISOString(),
    client_id: clientId,
  };

  feedbackStore.push(entry);

  // Keep store bounded
  if (feedbackStore.length > 10_000) {
    feedbackStore.splice(0, feedbackStore.length - 10_000);
  }

  return entry;
}

export function getFeedbackStats(): FeedbackStats {
  const bySignal: Record<FeedbackSignal, number> = {
    correct: 0,
    missing: 0,
    irrelevant: 0,
    unsafe: 0,
  };

  for (const entry of feedbackStore) {
    bySignal[entry.signal] = (bySignal[entry.signal] || 0) + 1;
  }

  return {
    total: feedbackStore.length,
    by_signal: bySignal,
    satisfaction_rate: feedbackStore.length > 0
      ? bySignal.correct / feedbackStore.length
      : 0,
    last_feedback: feedbackStore.length > 0
      ? feedbackStore[feedbackStore.length - 1].created_at
      : null,
  };
}

export function getRecentFeedback(limit = 50): FeedbackEntry[] {
  return feedbackStore.slice(-limit).reverse();
}

export function getTrainingDataset(): Array<{
  query: string;
  response: string;
  label: FeedbackSignal;
}> {
  return feedbackStore.map((e) => ({
    query: e.query,
    response: e.response_text,
    label: e.signal,
  }));
}

export function resetFeedback(): void {
  feedbackStore.length = 0;
  feedbackCounter = 0;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SIGNALS: FeedbackSignal[] = ["correct", "missing", "irrelevant", "unsafe"];

export function isValidSignal(signal: string): signal is FeedbackSignal {
  return VALID_SIGNALS.includes(signal as FeedbackSignal);
}
