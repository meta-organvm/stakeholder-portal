/**
 * Canonical Entity Registry with alias resolution.
 *
 * Provides:
 * - Canonical entity storage keyed by deterministic IDs
 * - Alias table (many names → one canonical ID)
 * - Confidence-scored lookup
 * - Merge/split workflow support
 */

import type { Entity, EntityClass, ContextEnvelope } from "./ontology";
import { makeEntityId, createEnvelope } from "./ontology";

// ---------------------------------------------------------------------------
// Alias entry
// ---------------------------------------------------------------------------

export interface AliasEntry {
  alias: string;           // the alternate name
  canonical_id: string;    // the resolved entity ID
  source: string;          // where this alias came from
  confidence: number;      // 0.0 – 1.0
  created_at: string;
}

// ---------------------------------------------------------------------------
// Merge/split audit
// ---------------------------------------------------------------------------

export interface MergeRecord {
  merged_ids: string[];
  surviving_id: string;
  reason: string;
  performed_at: string;
}

export interface SplitRecord {
  original_id: string;
  new_ids: string[];
  reason: string;
  performed_at: string;
}

// ---------------------------------------------------------------------------
// Lookup result
// ---------------------------------------------------------------------------

export interface LookupResult {
  entity: Entity;
  match_type: "exact" | "alias" | "fuzzy";
  confidence: number;
}

// ---------------------------------------------------------------------------
// Entity Registry
// ---------------------------------------------------------------------------

export class EntityRegistry {
  private entities = new Map<string, Entity>();
  private aliases = new Map<string, AliasEntry[]>();      // lowercase alias → entries
  private mergeLog: MergeRecord[] = [];
  private splitLog: SplitRecord[] = [];
  private reviewQueue: Array<{ entity_id: string; reason: string; created_at: string }> = [];

  private removeAliasesForCanonicalId(canonicalId: string): AliasEntry[] {
    const removed: AliasEntry[] = [];

    for (const [key, entries] of this.aliases) {
      const keep: AliasEntry[] = [];
      for (const entry of entries) {
        if (entry.canonical_id === canonicalId) removed.push(entry);
        else keep.push(entry);
      }

      if (keep.length > 0) {
        this.aliases.set(key, keep);
      } else {
        this.aliases.delete(key);
      }
    }

    return removed;
  }

  /** Register an entity with its canonical ID. */
  register(entity: Entity): void {
    this.entities.set(entity.id, entity);
    // Auto-add name-based aliases
    this.addAlias(entity.name, entity.id, "auto:name", 1.0);
    if (entity.display_name !== entity.name) {
      this.addAlias(entity.display_name, entity.id, "auto:display_name", 0.95);
    }
  }

  /** Add an alias mapping. */
  addAlias(alias: string, canonicalId: string, source: string, confidence = 0.9): void {
    const key = alias.toLowerCase().trim();
    if (!key) return;

    const existing = this.aliases.get(key) || [];
    // Avoid duplicates for same canonical_id
    if (existing.some((e) => e.canonical_id === canonicalId)) return;

    existing.push({
      alias,
      canonical_id: canonicalId,
      source,
      confidence,
      created_at: new Date().toISOString(),
    });
    this.aliases.set(key, existing);
  }

  /** Get entity by exact ID. */
  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /** Check if entity exists. */
  has(id: string): boolean {
    return this.entities.has(id);
  }

  /** Look up entity by name/alias with confidence scoring. */
  lookup(query: string): LookupResult | null {
    const key = query.toLowerCase().trim();
    if (!key) return null;

    // 1. Exact ID match
    const byId = this.entities.get(query);
    if (byId) return { entity: byId, match_type: "exact", confidence: 1.0 };

    // 2. Alias match
    const aliasEntries = this.aliases.get(key);
    if (aliasEntries && aliasEntries.length > 0) {
      // Pick highest confidence alias
      const best = aliasEntries.reduce((a, b) =>
        a.confidence >= b.confidence ? a : b
      );
      const entity = this.entities.get(best.canonical_id);
      if (entity) {
        return { entity, match_type: "alias", confidence: best.confidence };
      }
    }

    // 3. Fuzzy match (simple substring + edit distance)
    let bestMatch: { entity: Entity; score: number } | null = null;
    for (const entity of this.entities.values()) {
      const nameL = entity.name.toLowerCase();
      const displayL = entity.display_name.toLowerCase();

      let score = 0;
      if (nameL.includes(key)) score = 0.7;
      else if (displayL.includes(key)) score = 0.65;
      else if (key.includes(nameL) && nameL.length > 2) score = 0.6;

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { entity, score };
      }
    }

    if (bestMatch && bestMatch.score >= 0.5) {
      return {
        entity: bestMatch.entity,
        match_type: "fuzzy",
        confidence: bestMatch.score,
      };
    }

    return null;
  }

  /** Bulk lookup — returns top N matches sorted by confidence. */
  search(query: string, limit = 10): LookupResult[] {
    const key = query.toLowerCase().trim();
    if (!key) return [];

    const results: LookupResult[] = [];
    const seen = new Set<string>();

    // Alias matches
    for (const [aliasKey, entries] of this.aliases) {
      if (!aliasKey.includes(key) && !key.includes(aliasKey)) continue;
      for (const entry of entries) {
        if (seen.has(entry.canonical_id)) continue;
        const entity = this.entities.get(entry.canonical_id);
        if (!entity) continue;
        seen.add(entry.canonical_id);
        results.push({
          entity,
          match_type: "alias",
          confidence: entry.confidence * (aliasKey === key ? 1.0 : 0.8),
        });
      }
    }

    // Direct name matches
    for (const entity of this.entities.values()) {
      if (seen.has(entity.id)) continue;
      const nameL = entity.name.toLowerCase();
      const displayL = entity.display_name.toLowerCase();
      if (nameL.includes(key) || displayL.includes(key)) {
        seen.add(entity.id);
        results.push({
          entity,
          match_type: "fuzzy",
          confidence: nameL.includes(key) ? 0.7 : 0.65,
        });
      }
    }

    return results
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  /** List all entities, optionally filtered by class. */
  list(entityClass?: EntityClass): Entity[] {
    const all = [...this.entities.values()];
    if (!entityClass) return all;
    return all.filter((e) => e.entity_class === entityClass);
  }

  /** Count entities by class. */
  count(entityClass?: EntityClass): number {
    return this.list(entityClass).length;
  }

  /** Get all aliases for an entity. */
  getAliases(canonicalId: string): AliasEntry[] {
    const result: AliasEntry[] = [];
    for (const entries of this.aliases.values()) {
      for (const entry of entries) {
        if (entry.canonical_id === canonicalId) {
          result.push(entry);
        }
      }
    }
    return result;
  }

  /** Merge multiple entities into one surviving entity. */
  merge(mergedIds: string[], survivingId: string, reason: string): boolean {
    const survivor = this.entities.get(survivingId);
    if (!survivor) return false;

    for (const id of mergedIds) {
      if (id === survivingId) continue;
      const entity = this.entities.get(id);
      if (!entity) continue;

      // Transfer aliases from merged entity to survivor
      this.addAlias(entity.name, survivingId, `merge:${id}`, 0.85);
      this.addAlias(entity.display_name, survivingId, `merge:${id}`, 0.8);

      // Transfer existing aliases
      for (const entry of this.removeAliasesForCanonicalId(id)) {
        this.addAlias(entry.alias, survivingId, `merge:${id}`, entry.confidence * 0.9);
      }

      this.entities.delete(id);
    }

    this.mergeLog.push({
      merged_ids: mergedIds,
      surviving_id: survivingId,
      reason,
      performed_at: new Date().toISOString(),
    });

    return true;
  }

  /** Split one entity into multiple new entities. */
  split(originalId: string, newEntities: Entity[], reason: string): boolean {
    const original = this.entities.get(originalId);
    if (!original) return false;

    const uniqueNewEntities = newEntities.filter(
      (candidate, idx) =>
        candidate.id !== originalId &&
        newEntities.findIndex((e) => e.id === candidate.id) === idx
    );
    if (uniqueNewEntities.length === 0) return false;

    const primary = uniqueNewEntities[0];
    const originalAliases = this.removeAliasesForCanonicalId(originalId);

    this.entities.delete(originalId);
    for (const entity of uniqueNewEntities) {
      this.register(entity);
    }

    // Preserve legacy resolvability via primary split entity.
    this.addAlias(original.name, primary.id, `split:${originalId}`, 0.75);
    if (original.display_name !== original.name) {
      this.addAlias(original.display_name, primary.id, `split:${originalId}`, 0.7);
    }
    for (const entry of originalAliases) {
      this.addAlias(entry.alias, primary.id, `split:${originalId}`, Math.max(0.3, entry.confidence * 0.75));
    }

    this.splitLog.push({
      original_id: originalId,
      new_ids: uniqueNewEntities.map((e) => e.id),
      reason,
      performed_at: new Date().toISOString(),
    });

    return true;
  }

  /** Add entity to review queue for human disambiguation. */
  flagForReview(entityId: string, reason: string): void {
    this.reviewQueue.push({
      entity_id: entityId,
      reason,
      created_at: new Date().toISOString(),
    });
  }

  /** Get pending review items. */
  getReviewQueue(): Array<{ entity_id: string; reason: string; created_at: string }> {
    return [...this.reviewQueue];
  }

  /** Clear a review item. */
  resolveReview(entityId: string): void {
    this.reviewQueue = this.reviewQueue.filter((r) => r.entity_id !== entityId);
  }

  /** Get merge history. */
  getMergeLog(): MergeRecord[] {
    return [...this.mergeLog];
  }

  /** Get split history. */
  getSplitLog(): SplitRecord[] {
    return [...this.splitLog];
  }

  /** Export full registry state for serialization. */
  export(): {
    entities: Entity[];
    aliases: Array<{ key: string; entries: AliasEntry[] }>;
    mergeLog: MergeRecord[];
    splitLog: SplitRecord[];
    reviewQueue: Array<{ entity_id: string; reason: string; created_at: string }>;
  } {
    return {
      entities: [...this.entities.values()],
      aliases: [...this.aliases.entries()].map(([key, entries]) => ({ key, entries })),
      mergeLog: [...this.mergeLog],
      splitLog: [...this.splitLog],
      reviewQueue: [...this.reviewQueue],
    };
  }

  /** Import registry state from serialized data. */
  import(data: {
    entities: Entity[];
    aliases?: Array<{ key: string; entries: AliasEntry[] }>;
    mergeLog?: MergeRecord[];
    splitLog?: SplitRecord[];
    reviewQueue?: Array<{ entity_id: string; reason: string; created_at: string }>;
  }): void {
    for (const entity of data.entities) {
      this.entities.set(entity.id, entity);
    }
    if (data.aliases) {
      for (const { key, entries } of data.aliases) {
        this.aliases.set(key, entries);
      }
    }
    if (data.mergeLog) this.mergeLog = [...data.mergeLog];
    if (data.splitLog) this.splitLog = [...data.splitLog];
    if (data.reviewQueue) this.reviewQueue = [...data.reviewQueue];
  }
}

// ---------------------------------------------------------------------------
// Convenience: build entity from minimal args
// ---------------------------------------------------------------------------

export function createEntity(
  entityClass: EntityClass,
  name: string,
  description: string,
  attributes: Record<string, unknown> = {},
  envelope?: Partial<ContextEnvelope>
): Entity {
  const now = new Date().toISOString();
  return {
    id: makeEntityId(entityClass, name),
    entity_class: entityClass,
    name,
    display_name: name,
    description,
    attributes,
    envelope: createEnvelope({
      source_id: "entity-registry",
      source_type: "registry",
      ...envelope,
    }),
    created_at: now,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Singleton for the portal
// ---------------------------------------------------------------------------

let _instance: EntityRegistry | null = null;

export function getEntityRegistry(): EntityRegistry {
  if (!_instance) {
    _instance = new EntityRegistry();
  }
  return _instance;
}

export function resetEntityRegistry(): void {
  _instance = null;
}
