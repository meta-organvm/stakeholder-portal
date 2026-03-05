import { describe, it, expect, beforeEach } from "vitest";
import { ingestRecords, resetDedup, computeProvenanceScore } from "@/lib/ingestion";
import { resetEntityRegistry, getEntityRegistry } from "@/lib/entity-registry";
import { resetKnowledgeGraph, getKnowledgeGraph } from "@/lib/graph";
import { createEnvelope } from "@/lib/ontology";
import type { IngestRecord } from "@/lib/connectors/types";

function makeRecord(overrides: Partial<IngestRecord> = {}): IngestRecord {
  return {
    dedup_key: `test:${Math.random().toString(36).slice(2)}`,
    entity_class: "repo",
    name: "test-repo",
    description: "A test repository",
    attributes: {},
    envelope: createEnvelope({ source_id: "test", source_type: "github" }),
    ...overrides,
  };
}

describe("ingestion pipeline", () => {
  beforeEach(() => {
    resetDedup();
    resetEntityRegistry();
    resetKnowledgeGraph();
  });

  it("ingests valid records", () => {
    const records = [
      makeRecord({ dedup_key: "test:a", name: "repo-a", description: "Repo A" }),
      makeRecord({ dedup_key: "test:b", name: "repo-b", description: "Repo B" }),
    ];

    const result = ingestRecords(records);
    expect(result.ingested).toBe(2);
    expect(result.quarantined).toBe(0);
    expect(result.deduplicated).toBe(0);

    const registry = getEntityRegistry();
    expect(registry.count()).toBe(2);
  });

  it("deduplicates records with same dedup_key", () => {
    const records = [
      makeRecord({ dedup_key: "test:same", name: "repo-a" }),
      makeRecord({ dedup_key: "test:same", name: "repo-a-copy" }),
    ];

    const result = ingestRecords(records);
    expect(result.ingested).toBe(1);
    expect(result.deduplicated).toBe(1);
  });

  it("quarantines records with invalid entity_class", () => {
    const records = [
      makeRecord({
        entity_class: "invalid_class" as IngestRecord["entity_class"],
      }),
    ];

    const result = ingestRecords(records);
    expect(result.quarantined).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.quarantine).toHaveLength(1);
  });

  it("quarantines records with missing name", () => {
    const records = [makeRecord({ name: "" })];
    const result = ingestRecords(records);
    expect(result.quarantined).toBe(1);
  });

  it("registers aliases from records", () => {
    const records = [
      makeRecord({
        dedup_key: "test:alias-test",
        name: "my-repo",
        aliases: ["My Repo", "the-repo"],
      }),
    ];

    ingestRecords(records);

    const registry = getEntityRegistry();
    const result = registry.lookup("My Repo");
    expect(result).not.toBeNull();
  });

  it("creates graph edges from relationships", () => {
    const records = [
      makeRecord({
        dedup_key: "test:with-rel",
        name: "repo-with-dep",
        relationships: [
          { type: "depends_on", target_hint: "repo:other-repo", strength: 0.9 },
        ],
      }),
    ];

    ingestRecords(records);

    const graph = getKnowledgeGraph();
    expect(graph.edgeCount()).toBe(1);
  });

  it("quarantines records with invalid relationship type", () => {
    const records = [
      makeRecord({
        dedup_key: "test:bad-rel-type",
        relationships: [
          { type: "invented_relation", target_hint: "repo:other-repo" },
        ],
      }),
    ];

    const result = ingestRecords(records);
    expect(result.ingested).toBe(0);
    expect(result.quarantined).toBe(1);
    expect(result.errors.some((e) => e.field === "relationships[0].type")).toBe(true);
  });

  it("quarantines records with out-of-range relationship strength", () => {
    const records = [
      makeRecord({
        dedup_key: "test:bad-rel-strength",
        relationships: [
          { type: "depends_on", target_hint: "repo:other-repo", strength: 1.5 },
        ],
      }),
    ];

    const result = ingestRecords(records);
    expect(result.ingested).toBe(0);
    expect(result.quarantined).toBe(1);
    expect(result.errors.some((e) => e.field === "relationships[0].strength")).toBe(true);
  });
});

describe("computeProvenanceScore", () => {
  it("scores github source higher than manual", () => {
    const github = makeRecord({ envelope: createEnvelope({ source_id: "gh", source_type: "github" }) });
    const manual = makeRecord({ envelope: createEnvelope({ source_id: "man", source_type: "manual" }) });

    expect(computeProvenanceScore(github)).toBeGreaterThan(computeProvenanceScore(manual));
  });

  it("returns score between 0 and 1", () => {
    const record = makeRecord();
    const score = computeProvenanceScore(record);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
