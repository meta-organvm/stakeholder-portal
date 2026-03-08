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

function makeAdvisorRequest(
  payload: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.99",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

const VALID_ADVISOR_PAYLOAD = {
  messages: [{ role: "user", content: "What is the biggest risk?" }],
  mode: "advisor",
};

const VALID_HERMENEUS_PAYLOAD = {
  messages: [{ role: "user", content: "Tell me about the ingestion pipeline architecture" }],
};

beforeEach(() => {
  fetchMock.mockReset();
  delete process.env.GROQ_API_KEY;
  delete process.env.OSS_LLM_API_KEY;
  delete process.env.ADMIN_API_TOKEN;
  delete process.env.ADMIN_SESSION_SECRET;
  delete process.env.TRUST_PROXY_IP_HEADERS;
  delete process.env.EDGE_RATE_LIMIT_ENABLED;
  delete process.env.CHAT_DIAGNOSTICS_ENABLED;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Advisor persona", () => {
  it("returns 403 for advisor mode without credentials", async () => {
    const POST = await loadPostHandler();
    const req = makeAdvisorRequest(VALID_ADVISOR_PAYLOAD);
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/admin authentication/i);
  });

  it("allows advisor mode with valid x-admin-token header", async () => {
    process.env.ADMIN_API_TOKEN = "test-secret-token";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Strategic advice here." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const POST = await loadPostHandler();
    const req = makeAdvisorRequest(VALID_ADVISOR_PAYLOAD, {
      "x-admin-token": "test-secret-token",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("default mode (no mode field) uses hermeneus — no auth required", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "System overview." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const POST = await loadPostHandler();
    const req = makeAdvisorRequest(VALID_HERMENEUS_PAYLOAD);
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("passes higher temperature/max_tokens for advisor mode", async () => {
    process.env.ADMIN_API_TOKEN = "test-secret-token";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Strategic response." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const POST = await loadPostHandler();
    const req = makeAdvisorRequest(VALID_ADVISOR_PAYLOAD, {
      "x-admin-token": "test-secret-token",
    });
    await POST(req);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.temperature).toBe(0.45);
    expect(body.max_tokens).toBe(2400);
  });

  it("passes standard temperature/max_tokens for hermeneus mode", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Info response." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const POST = await loadPostHandler();
    const req = makeAdvisorRequest(VALID_HERMENEUS_PAYLOAD);
    await POST(req);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(1800);
  });

  it("system prompt contains strategic counselor text for advisor mode", async () => {
    process.env.ADMIN_API_TOKEN = "test-secret-token";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Advice." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const POST = await loadPostHandler();
    const req = makeAdvisorRequest(VALID_ADVISOR_PAYLOAD, {
      "x-admin-token": "test-secret-token",
    });
    await POST(req);

    const fetchCall = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const systemMessage = body.messages[0];
    expect(systemMessage.role).toBe("system");
    expect(systemMessage.content).toContain("strategic counselor");
  });
});
