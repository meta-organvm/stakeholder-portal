/**
 * Agentic Titan bridge connector.
 *
 * Routes complex analysis requests through Titan's orchestration layer.
 * Silently returns empty results when TITAN_API_URL is not configured
 * (same pattern as the knowledge-base connector).
 */

const TITAN_API_URL = process.env.TITAN_API_URL;

export interface TitanTaskResult {
  taskId: string;
  status: "completed" | "failed" | "timeout";
  result?: string;
  model?: string;
  agentType?: string;
}

export async function routeCognitiveTask(
  query: string,
  context?: string,
): Promise<TitanTaskResult | null> {
  if (!TITAN_API_URL) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${TITAN_API_URL}/api/titan/route-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, context }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[TitanConnector] API returned ${res.status}`);
      return null;
    }

    return (await res.json()) as TitanTaskResult;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === "AbortError") {
      console.warn("[TitanConnector] Request timed out after 10s");
    } else {
      console.warn(`[TitanConnector] Failed to reach Titan: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function startInquiry(
  question: string,
  scope?: string,
): Promise<TitanTaskResult | null> {
  if (!TITAN_API_URL) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${TITAN_API_URL}/api/titan/inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, scope }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return (await res.json()) as TitanTaskResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isTitanAvailable(): boolean {
  return !!TITAN_API_URL;
}
