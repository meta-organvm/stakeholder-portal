/**
 * GET /api/health/llm
 *
 * Probes the configured LLM provider with a minimal request.
 * Returns provider name, status, latency, and model.
 * No auth required — returns only health metadata, no secrets.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store",
    },
  });
}

const DEFAULT_GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_OSS_LLM_API_URL = "https://text.pollinations.ai/openai";
const DEFAULT_OSS_LLM_MODEL = "openai-fast";

interface ProviderHealth {
  provider: string;
  model: string;
  status: "ok" | "error" | "timeout";
  latency_ms: number;
  error?: string;
}

async function probeProvider(
  apiUrl: string,
  model: string,
  apiKey: string | undefined, // allow-secret: env-derived token pass-through
  providerName: string,
  timeoutMs = 10_000
): Promise<ProviderHealth> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        max_tokens: 5,
        messages: [{ role: "user", content: "Reply with: ok" }],
      }),
      signal: controller.signal,
    });

    const latency = Date.now() - start;

    if (!response.ok) {
      return {
        provider: providerName,
        model,
        status: "error",
        latency_ms: latency,
        error: `HTTP ${response.status}`,
      };
    }

    return {
      provider: providerName,
      model,
      status: "ok",
      latency_ms: latency,
    };
  } catch (err) {
    const latency = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      provider: providerName,
      model,
      status: isTimeout ? "timeout" : "error",
      latency_ms: latency,
      error: isTimeout ? `Timeout after ${timeoutMs}ms` : (err instanceof Error ? err.message : "Unknown error"),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET() {
  // allow-secret: env lookup only, no hardcoded credential.
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqUrl = process.env.GROQ_API_URL || DEFAULT_GROQ_API_URL;
  const groqModel = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const ossUrl = process.env.OSS_LLM_API_URL || DEFAULT_OSS_LLM_API_URL;
  const ossModel = process.env.OSS_LLM_MODEL || DEFAULT_OSS_LLM_MODEL;

  const providers: ProviderHealth[] = [];

  // Probe primary (Groq) if configured
  if (groqApiKey) {
    providers.push(
      await probeProvider(groqUrl, groqModel, groqApiKey, "Groq")
    );
  }

  // Probe OSS fallback
  providers.push(
    await probeProvider(ossUrl, ossModel, process.env.OSS_LLM_API_KEY, "OSS Fallback")
  );

  const primary = providers.find((p) => p.status === "ok");
  const allDown = providers.every((p) => p.status !== "ok");

  return json({
    timestamp: new Date().toISOString(),
    active_provider: primary?.provider ?? null,
    groq_configured: Boolean(groqApiKey),
    status: allDown ? "degraded" : "healthy",
    providers,
  }, allDown ? 503 : 200);
}
