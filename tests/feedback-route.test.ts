import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/feedback/route";
import { getRecentFeedback, resetFeedback } from "@/lib/feedback";

describe("POST /api/feedback", () => {
  beforeEach(() => {
    resetFeedback();
  });

  it("rejects oversized query payloads", async () => {
    const res = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "x".repeat(2001),
          response_text: "ok",
          signal: "correct",
        }),
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "query exceeds 2000 characters" });
  });

  it("rejects oversized response_text payloads", async () => {
    const res = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "ok",
          response_text: "x".repeat(4001),
          signal: "correct",
        }),
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "response_text exceeds 4000 characters" });
  });

  it("normalizes and records bounded feedback payload", async () => {
    const res = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "  What is ORGANVM?  ",
          response_text: "  A system summary.  ",
          signal: "missing",
          comment: "  add deployment metrics  ",
          citation_ids: Array.from({ length: 75 }, (_, i) => ` cite-${i + 1} `),
        }),
      })
    );

    expect(res.status).toBe(200);
    const stored = getRecentFeedback(1)[0];
    expect(stored.query).toBe("What is ORGANVM?");
    expect(stored.response_text).toBe("A system summary.");
    expect(stored.comment).toBe("add deployment metrics");
    expect(stored.citation_ids).toHaveLength(50);
  });
});

describe("GET /api/feedback", () => {
  it("returns feedback stats", async () => {
    resetFeedback();
    await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "q",
          response_text: "r",
          signal: "correct",
        }),
      })
    );

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      total: 1,
      by_signal: {
        correct: 1,
      },
    });
  });
});
