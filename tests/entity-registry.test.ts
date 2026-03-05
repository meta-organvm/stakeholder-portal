import { describe, it, expect, beforeEach } from "vitest";
import {
  EntityRegistry,
  createEntity,
  getEntityRegistry,
  resetEntityRegistry,
} from "@/lib/entity-registry";

describe("EntityRegistry", () => {
  let registry: EntityRegistry;

  beforeEach(() => {
    registry = new EntityRegistry();
  });

  it("registers and retrieves entities", () => {
    const entity = createEntity("repo", "organvm-engine", "Core engine");
    registry.register(entity);

    expect(registry.has(entity.id)).toBe(true);
    expect(registry.get(entity.id)).toBe(entity);
    expect(registry.count()).toBe(1);
    expect(registry.count("repo")).toBe(1);
    expect(registry.count("organ")).toBe(0);
  });

  it("auto-adds name aliases on register", () => {
    const entity = createEntity("repo", "organvm-engine", "Core engine");
    registry.register(entity);

    const result = registry.lookup("organvm-engine");
    expect(result).not.toBeNull();
    expect(result?.entity.id).toBe(entity.id);
    expect(result?.match_type).toBe("alias");
  });

  it("supports manual alias addition", () => {
    const entity = createEntity("repo", "organvm-engine", "Core engine");
    registry.register(entity);
    registry.addAlias("the engine", entity.id, "manual", 0.9);

    const result = registry.lookup("the engine");
    expect(result).not.toBeNull();
    expect(result?.entity.id).toBe(entity.id);
  });

  it("lookup returns exact match for entity ID", () => {
    const entity = createEntity("repo", "test-repo", "Test");
    registry.register(entity);

    const result = registry.lookup(entity.id);
    expect(result?.match_type).toBe("exact");
    expect(result?.confidence).toBe(1.0);
  });

  it("fuzzy matches on partial name", () => {
    const entity = createEntity("repo", "organvm-engine", "Core engine package");
    registry.register(entity);

    const result = registry.lookup("engine");
    expect(result).not.toBeNull();
    expect(result?.match_type).toBe("fuzzy");
  });

  it("search returns multiple results sorted by confidence", () => {
    registry.register(createEntity("repo", "engine-a", "Engine A"));
    registry.register(createEntity("repo", "engine-b", "Engine B"));
    registry.register(createEntity("repo", "dashboard", "Dashboard"));

    const results = registry.search("engine");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Results should be sorted by confidence descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
    }
  });

  it("merge combines entities and transfers aliases", () => {
    const entityA = createEntity("repo", "repo-alpha", "Alpha");
    const entityB = createEntity("repo", "repo-beta", "Beta");
    registry.register(entityA);
    registry.register(entityB);

    const success = registry.merge([entityA.id, entityB.id], entityA.id, "Duplicate");
    expect(success).toBe(true);
    expect(registry.has(entityA.id)).toBe(true);
    expect(registry.has(entityB.id)).toBe(false);
    expect(registry.count()).toBe(1);

    // Can still find by old name via alias
    const result = registry.lookup("repo-beta");
    expect(result).not.toBeNull();
    expect(result?.entity.id).toBe(entityA.id);
  });

  it("split replaces an entity with new entities and preserves legacy alias routing", () => {
    const original = createEntity("repo", "organvm-core", "Core package");
    original.display_name = "ORGANVM Core";
    registry.register(original);
    registry.addAlias("core", original.id, "manual", 0.95);

    const api = createEntity("repo", "organvm-core-api", "Core API");
    const worker = createEntity("repo", "organvm-core-worker", "Core worker");
    const success = registry.split(original.id, [api, worker], "Split monolith");

    expect(success).toBe(true);
    expect(registry.has(original.id)).toBe(false);
    expect(registry.has(api.id)).toBe(true);
    expect(registry.has(worker.id)).toBe(true);
    expect(registry.count()).toBe(2);

    const legacyLookup = registry.lookup("core");
    expect(legacyLookup).not.toBeNull();
    expect(legacyLookup?.entity.id).toBe(api.id);

    const splitLog = registry.getSplitLog();
    expect(splitLog).toHaveLength(1);
    expect(splitLog[0].original_id).toBe(original.id);
    expect(splitLog[0].new_ids).toEqual([api.id, worker.id]);
  });

  it("flagForReview and resolveReview work", () => {
    const entity = createEntity("repo", "ambiguous", "Test");
    registry.register(entity);
    registry.flagForReview(entity.id, "Potential duplicate");

    expect(registry.getReviewQueue()).toHaveLength(1);

    registry.resolveReview(entity.id);
    expect(registry.getReviewQueue()).toHaveLength(0);
  });

  it("export/import roundtrips", () => {
    registry.register(createEntity("repo", "test-a", "A"));
    registry.register(createEntity("organ", "organ-i", "Organ I"));

    const exported = registry.export();
    expect(exported.entities).toHaveLength(2);

    const newRegistry = new EntityRegistry();
    newRegistry.import({
      entities: exported.entities,
      aliases: exported.aliases,
      mergeLog: exported.mergeLog,
      splitLog: exported.splitLog,
      reviewQueue: exported.reviewQueue,
    });
    expect(newRegistry.count()).toBe(2);
  });
});

describe("singleton", () => {
  beforeEach(() => resetEntityRegistry());

  it("returns same instance", () => {
    const a = getEntityRegistry();
    const b = getEntityRegistry();
    expect(a).toBe(b);
  });

  it("reset creates new instance", () => {
    const a = getEntityRegistry();
    resetEntityRegistry();
    const b = getEntityRegistry();
    expect(a).not.toBe(b);
  });
});
