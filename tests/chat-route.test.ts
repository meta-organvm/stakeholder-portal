import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/retrieval", () => ({
  buildTier1Context: () => "tier1",
  buildTier2Context: () => "tier2",
}));

vi.mock("@/lib/hybrid-retrieval", () => ({
  hybridRetrieve: vi.fn().mockResolvedValue({
    query: "test",
    sources: [],
    context: "mocked hybrid context",
    tier1: "tier1",
    strategy: "hybrid",
    total_candidates: 0,
  }),
  resetHybridRetrievalCache: vi.fn(),
}));

const fetchMock = vi.fn();

async function loadPostHandler() {
  vi.resetModules();
  const mod = await import("@/app/api/chat/route");
  return mod.POST;
}

function makeRequest(ip: string, payload: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(payload),
  });
}

function makeRequestWithHeaders(payload: unknown, headers: Record<string, string>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
  delete process.env.GROQ_API_URL;
  delete process.env.OSS_LLM_API_KEY;
  delete process.env.OSS_LLM_MODEL;
  delete process.env.OSS_LLM_API_URL;
  delete process.env.TRUST_PROXY_IP_HEADERS;
  delete process.env.EDGE_RATE_LIMIT_ENABLED;
  delete process.env.EDGE_BLOCK_HEADER;
  delete process.env.EDGE_REMAINING_HEADER;
  delete process.env.EDGE_RETRY_AFTER_HEADER;
  delete process.env.CHAT_DIAGNOSTICS_ENABLED;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/chat", () => {
  it("returns 400 for invalid JSON payload", async () => {
    const POST = await loadPostHandler();
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: "{invalid",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON payload" });
  });

  it("returns 400 when no valid messages are provided", async () => {
    const POST = await loadPostHandler();
    const res = await POST(makeRequest("10.0.0.2", { messages: [{ role: "system", content: 5 }] }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No messages provided" });
  });

  it("enforces rate limiting per client IP", async () => {
    process.env.TRUST_PROXY_IP_HEADERS = "1";
    const POST = await loadPostHandler();
    const payload = { messages: [{ role: "user", content: "hello" }] };
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    for (let i = 0; i < 10; i += 1) {
      const res = await POST(makeRequest("10.0.0.3", payload));
      expect(res.status).toBe(200);
    }

    const limited = await POST(makeRequest("10.0.0.3", payload));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Rate limited. Try again in a minute." });
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("does not trust unverified x-forwarded-for headers by default", async () => {
    const POST = await loadPostHandler();
    const payload = { messages: [{ role: "user", content: "hello" }] };
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    for (let i = 0; i < 10; i += 1) {
      const res = await POST(makeRequest("198.51.100.1", payload));
      expect(res.status).toBe(200);
    }

    // With default settings (no trusted proxy markers), this still maps to the
    // same anonymous client key and remains rate-limited.
    const limited = await POST(makeRequest("203.0.113.99", payload));
    expect(limited.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("trusts proxy IP headers when TRUST_PROXY_IP_HEADERS=1", async () => {
    process.env.TRUST_PROXY_IP_HEADERS = "1";
    const POST = await loadPostHandler();
    const payload = { messages: [{ role: "user", content: "hello" }] };
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    for (let i = 0; i < 10; i += 1) {
      const res = await POST(makeRequest("10.0.0.21", payload));
      expect(res.status).toBe(200);
    }

    // Different forwarded IP should be allowed because TRUST_PROXY_IP_HEADERS is enabled.
    const nextClient = await POST(makeRequest("10.0.0.22", payload));
    expect(nextClient.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it("honors edge rate-limit blocked headers", async () => {
    process.env.EDGE_RATE_LIMIT_ENABLED = "1";
    const POST = await loadPostHandler();
    const payload = { messages: [{ role: "user", content: "hello" }] };

    const res = await POST(
      makeRequestWithHeaders(payload, {
        "x-edge-rate-limit-blocked": "1",
        "retry-after": "45",
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
    expect(await res.json()).toEqual({ error: "Rate limited. Try again in a minute." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors edge remaining header when remaining is zero", async () => {
    process.env.EDGE_RATE_LIMIT_ENABLED = "1";
    const POST = await loadPostHandler();
    const payload = { messages: [{ role: "user", content: "hello" }] };

    const res = await POST(
      makeRequestWithHeaders(payload, {
        "x-ratelimit-remaining": "0",
        "retry-after": "30",
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only the last 10 messages and truncates oversized content for OSS provider", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const POST = await loadPostHandler();
    const longContent = "x".repeat(5000);
    const messages = Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `${i}:${longContent}`,
    }));
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await POST(makeRequest("10.0.0.4", { messages }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [providerUrl, providerInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(providerUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(providerInit.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer gsk_test",
      })
    );
    const payload = JSON.parse(String(providerInit.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };

    expect(payload.model).toBe("llama-3.3-70b-versatile");
    expect(payload.messages).toHaveLength(11); // system prompt + last 10 chat messages
    for (const forwarded of payload.messages.slice(1)) {
      expect(forwarded.content.length).toBe(4000);
    }
  });

  it("uses anonymous OSS fallback provider when GROQ_API_KEY is not set", async () => {
    const POST = await loadPostHandler();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await POST(makeRequest("10.0.0.9", { messages: [{ role: "user", content: "hello" }] }));
    expect(res.status).toBe(200);
    const [providerUrl, providerInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(providerUrl).toBe("https://text.pollinations.ai/openai");
    expect(providerInit.headers).not.toEqual(
      expect.objectContaining({
        Authorization: expect.any(String),
      })
    );
  });

  it("returns offline snapshot response when OSS provider fails", async () => {
    fetchMock.mockResolvedValue(new Response("provider unavailable", { status: 503 }));
    const POST = await loadPostHandler();
    const res = await POST(
      makeRequest("10.0.0.5", {
        messages: [{ role: "user", content: "Give me a broad narrative summary of governance constraints." }],
      })
    );

    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain("ORGANVM Snapshot Response");
    expect(body).toContain("live OSS model path is currently unavailable");
    expect(body).toContain("The AI assistant is temporarily unavailable");
    expect(body).not.toContain("GROQ_API_KEY");
    expect(body).not.toContain("OSS_LLM_API_URL");
    expect(body).toContain("\"strategy\":\"offline_fallback\"");
    expect(body).toContain("data: [DONE]");
  });

  it("routes sprint queries through the LLM instead of canned responses", async () => {
    const POST = await loadPostHandler();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "The last sprint covered governance work." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const res = await POST(
      makeRequest("10.0.0.6", { messages: [{ role: "user", content: "What happened in the last sprint?" }] })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = await res.text();
    expect(body).toContain("The last sprint covered governance work.");
  });

  it("includes diagnostics payload when CHAT_DIAGNOSTICS_ENABLED=1", async () => {
    process.env.CHAT_DIAGNOSTICS_ENABLED = "1";
    const POST = await loadPostHandler();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Sprint info here." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const res = await POST(
      makeRequest("10.0.0.11", { messages: [{ role: "user", content: "What happened in the last sprint?" }] })
    );

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("\"diagnostics\":{");
    expect(body).toContain("\"path\":\"hybrid_retrieval\"");
  });

  it("falls through to LLM when tech stack repo is unknown", async () => {
    const POST = await loadPostHandler();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "No repo named Xyzzyx exists. The closest matches are..." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await POST(
      makeRequest("10.0.0.7", { messages: [{ role: "user", content: "What's the tech stack for Xyzzyx?" }] })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = await res.text();
    expect(body).toContain("No repo named Xyzzyx exists");
  });

  it("returns explicit limitation for live-research queries without calling provider", async () => {
    const POST = await loadPostHandler();
    const res = await POST(
      makeRequest("10.0.0.8", {
        messages: [{ role: "user", content: "Give me the latest competitor news about this project" }],
      })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();

    const body = await res.text();
    expect(body).toContain("Live Research Query Detected");
    expect(body).toContain("cannot currently perform real-time external retrieval");
    expect(body).toContain("\"strategy\":\"live_research\"");
    expect(body).toContain("\"suggestions\":[");
    expect(body).toContain("Which ORGANVM repo or organ should I scope this to?");
  });

  it("passes through partial answers instead of blocking them", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const POST = await loadPostHandler();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "There are 50 active repos." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const res = await POST(
      makeRequest("10.0.0.10", {
        messages: [{ role: "user", content: "What is the salary range for this project?" }],
      })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = await res.text();
    // With relaxed guardrails, the LLM response passes through
    expect(body).toContain("There are 50 active repos.");
    expect(body).toContain("\"answerability\":\"partial\"");
    expect(body).toContain("\"suggestions\":[");
  });
});
