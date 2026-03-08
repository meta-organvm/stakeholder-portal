import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  // Reset module env
  delete process.env.MY_KNOWLEDGE_BASE_ENABLED;
  delete process.env.MY_KNOWLEDGE_BASE_API_URL;
  delete process.env.MY_KNOWLEDGE_BASE_UI_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("fetchFederatedKnowledge", () => {
  it("returns empty array when MY_KNOWLEDGE_BASE_ENABLED is not set", async () => {
    process.env.MY_KNOWLEDGE_BASE_ENABLED = "false";
    process.env.MY_KNOWLEDGE_BASE_API_URL = "https://kb.example.com";
    const { fetchFederatedKnowledge } = await import("@/lib/knowledge-base-connector");
    const result = await fetchFederatedKnowledge("test query");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty array when MY_KNOWLEDGE_BASE_API_URL is not set", async () => {
    process.env.MY_KNOWLEDGE_BASE_ENABLED = "true";
    delete process.env.MY_KNOWLEDGE_BASE_API_URL;
    const { fetchFederatedKnowledge } = await import("@/lib/knowledge-base-connector");
    const result = await fetchFederatedKnowledge("test query");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns mapped RetrievalSource array on successful API response", async () => {
    process.env.MY_KNOWLEDGE_BASE_ENABLED = "true";
    process.env.MY_KNOWLEDGE_BASE_API_URL = "https://kb.example.com";
    process.env.MY_KNOWLEDGE_BASE_UI_URL = "https://kb-ui.example.com";

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "unit-1",
              source: "conversations",
              content: "This is a knowledge base entry about testing.",
              timestamp: "2026-03-01T00:00:00Z",
              score: 0.85,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { fetchFederatedKnowledge } = await import("@/lib/knowledge-base-connector");
    const result = await fetchFederatedKnowledge("test query");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "unit-1",
      type: "manifest",
      name: "KB: conversations",
      display_name: "Personal Knowledge Base",
      source_type: "knowledge_base",
    });
    expect(result[0].relevance).toBeCloseTo(0.85 * 0.9, 2);
    expect(result[0].url).toContain("https://kb-ui.example.com/unit/unit-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty array on non-200 API response", async () => {
    process.env.MY_KNOWLEDGE_BASE_ENABLED = "true";
    process.env.MY_KNOWLEDGE_BASE_API_URL = "https://kb.example.com";

    fetchMock.mockResolvedValue(
      new Response("Internal Server Error", { status: 500 })
    );

    const { fetchFederatedKnowledge } = await import("@/lib/knowledge-base-connector");
    const result = await fetchFederatedKnowledge("test query");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty array on fetch error (network failure)", async () => {
    process.env.MY_KNOWLEDGE_BASE_ENABLED = "true";
    process.env.MY_KNOWLEDGE_BASE_API_URL = "https://kb.example.com";

    fetchMock.mockRejectedValue(new Error("Network error"));

    const { fetchFederatedKnowledge } = await import("@/lib/knowledge-base-connector");
    const result = await fetchFederatedKnowledge("test query");

    expect(result).toEqual([]);
  });

  it("returns empty array on timeout (AbortError)", async () => {
    process.env.MY_KNOWLEDGE_BASE_ENABLED = "true";
    process.env.MY_KNOWLEDGE_BASE_API_URL = "https://kb.example.com";

    const abortError = new DOMException("The operation was aborted", "AbortError");
    fetchMock.mockRejectedValue(abortError);

    const { fetchFederatedKnowledge } = await import("@/lib/knowledge-base-connector");
    const result = await fetchFederatedKnowledge("test query");

    expect(result).toEqual([]);
  });

  it("uses strategy-aware params (meta_vision gets 8 results)", async () => {
    process.env.MY_KNOWLEDGE_BASE_ENABLED = "true";
    process.env.MY_KNOWLEDGE_BASE_API_URL = "https://kb.example.com";

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const { fetchFederatedKnowledge } = await import("@/lib/knowledge-base-connector");
    await fetchFederatedKnowledge("test", "meta_vision");

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("limit")).toBe("8");
  });

  it("defaults to 3 results without strategy", async () => {
    process.env.MY_KNOWLEDGE_BASE_ENABLED = "true";
    process.env.MY_KNOWLEDGE_BASE_API_URL = "https://kb.example.com";

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const { fetchFederatedKnowledge } = await import("@/lib/knowledge-base-connector");
    await fetchFederatedKnowledge("test");

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("limit")).toBe("3");
  });
});
