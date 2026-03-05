/**
 * Ingestion Pipeline
 *
 * Normalization, validation, dedup, and provenance scoring.
 * Failed records are quarantined with diagnostic info.
 */

import type { IngestRecord } from "./connectors/types";
import type { RelationshipType } from "./ontology";
import { ENTITY_CLASSES, RELATIONSHIP_TYPES } from "./ontology";
import { getEntityRegistry, createEntity } from "./entity-registry";
import { getKnowledgeGraph } from "./graph";

// ---------------------------------------------------------------------------
// Pipeline types
// ---------------------------------------------------------------------------

export interface ValidationError {
  record_key: string;
  field: string;
  message: string;
}

export interface QuarantinedRecord {
  record: IngestRecord;
  errors: ValidationError[];
  quarantined_at: string;
}

export interface PipelineResult {
  ingested: number;
  deduplicated: number;
  quarantined: number;
  errors: ValidationError[];
  quarantine: QuarantinedRecord[];
}

// ---------------------------------------------------------------------------
// Dedup tracker
// ---------------------------------------------------------------------------

const seenKeys = new Set<string>();

export function resetDedup(): void {
  seenKeys.clear();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateRecord(record: IngestRecord): ValidationError[] {
  const errors: ValidationError[] = [];
  const key = record.dedup_key;

  if (!record.dedup_key || typeof record.dedup_key !== "string") {
    errors.push({ record_key: key, field: "dedup_key", message: "Missing or invalid dedup_key" });
  }

  if (!ENTITY_CLASSES.includes(record.entity_class)) {
    errors.push({
      record_key: key,
      field: "entity_class",
      message: `Invalid entity_class: ${record.entity_class}`,
    });
  }

  if (!record.name || typeof record.name !== "string") {
    errors.push({ record_key: key, field: "name", message: "Missing or invalid name" });
  }

  if (!record.description || typeof record.description !== "string") {
    errors.push({ record_key: key, field: "description", message: "Missing or invalid description" });
  }

  if (!record.envelope || typeof record.envelope !== "object") {
    errors.push({ record_key: key, field: "envelope", message: "Missing context envelope" });
  } else {
    if (!record.envelope.source_id) {
      errors.push({ record_key: key, field: "envelope.source_id", message: "Missing source_id" });
    }
    if (
      typeof record.envelope.confidence !== "number" ||
      record.envelope.confidence < 0 ||
      record.envelope.confidence > 1
    ) {
      errors.push({
        record_key: key,
        field: "envelope.confidence",
        message: "Confidence must be between 0 and 1",
      });
    }
  }

  // Validate relationships
  if (record.relationships) {
    if (!Array.isArray(record.relationships)) {
      errors.push({
        record_key: key,
        field: "relationships",
        message: "Relationships must be an array when provided",
      });
      return errors;
    }

    for (const [i, rel] of record.relationships.entries()) {
      if (!rel.type || !rel.target_hint) {
        errors.push({
          record_key: key,
          field: `relationships[${i}]`,
          message: "Relationship missing type or target_hint",
        });
        continue;
      }

      const relType = rel.type as RelationshipType;
      if (!RELATIONSHIP_TYPES.includes(relType)) {
        errors.push({
          record_key: key,
          field: `relationships[${i}].type`,
          message: `Invalid relationship type: ${rel.type}`,
        });
      }

      if (typeof rel.strength !== "undefined") {
        if (typeof rel.strength !== "number" || rel.strength < 0 || rel.strength > 1) {
          errors.push({
            record_key: key,
            field: `relationships[${i}].strength`,
            message: "Relationship strength must be between 0 and 1",
          });
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeRecord(record: IngestRecord): IngestRecord {
  return {
    ...record,
    name: record.name.trim().toLowerCase().replace(/\s+/g, "-"),
    display_name: record.display_name?.trim() || humanizeSlug(record.name),
    description: record.description.trim().slice(0, 2000),
    attributes: { ...record.attributes },
    aliases: (record.aliases || []).map((a) => a.trim()).filter(Boolean),
  };
}

function humanizeSlug(slug: string): string {
  return slug
    .replace(/--/g, ": ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Pipeline execution
// ---------------------------------------------------------------------------

export function ingestRecords(records: IngestRecord[]): PipelineResult {
  const result: PipelineResult = {
    ingested: 0,
    deduplicated: 0,
    quarantined: 0,
    errors: [],
    quarantine: [],
  };

  const registry = getEntityRegistry();
  const graph = getKnowledgeGraph();

  for (const raw of records) {
    // Dedup check
    if (seenKeys.has(raw.dedup_key)) {
      result.deduplicated += 1;
      continue;
    }

    // Validate
    const errors = validateRecord(raw);
    if (errors.length > 0) {
      result.quarantined += 1;
      result.errors.push(...errors);
      result.quarantine.push({
        record: raw,
        errors,
        quarantined_at: new Date().toISOString(),
      });
      continue;
    }

    // Normalize
    const normalized = normalizeRecord(raw);

    // Mark as seen
    seenKeys.add(normalized.dedup_key);

    // Create entity and register
    const entity = createEntity(
      normalized.entity_class,
      normalized.name,
      normalized.description,
      normalized.attributes,
      {
        source_id: normalized.envelope.source_id,
        source_type: normalized.envelope.source_type,
        confidence: normalized.envelope.confidence,
        channel: normalized.envelope.channel,
      }
    );
    entity.display_name = normalized.display_name || entity.display_name;

    registry.register(entity);

    // Register aliases
    if (normalized.aliases) {
      for (const alias of normalized.aliases) {
        registry.addAlias(alias, entity.id, normalized.envelope.source_type, 0.85);
      }
    }

    // Add to graph
    graph.addNode(entity);

    // Process relationships
    if (normalized.relationships) {
      for (const rel of normalized.relationships) {
        const relType = rel.type as RelationshipType;
        if (!RELATIONSHIP_TYPES.includes(relType)) continue;

        graph.addEdge({
          id: `${entity.id}-${relType}-${rel.target_hint}`,
          type: relType,
          source_id: entity.id,
          target_id: rel.target_hint,
          strength: rel.strength ?? 0.8,
          direction: "forward",
          evidence: rel.evidence ? [rel.evidence] : [],
          envelope: entity.envelope,
          created_at: entity.created_at,
          updated_at: entity.updated_at,
        });
      }
    }

    result.ingested += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Provenance scoring
// ---------------------------------------------------------------------------

export function computeProvenanceScore(record: IngestRecord): number {
  let score = 0;

  // Source reliability
  const sourceWeights: Record<string, number> = {
    github: 0.95,
    workspace: 0.9,
    manual: 0.7,
    webhook: 0.85,
    crawl: 0.8,
  };
  score += sourceWeights[record.envelope.source_type] ?? 0.5;

  // Freshness (decay over 30 days)
  const ageMs = Date.now() - new Date(record.envelope.ingested_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const freshnessScore = Math.max(0, 1 - ageDays / 30);
  score += freshnessScore;

  // Completeness
  const fields = ["name", "description", "attributes"];
  const completeness = fields.filter(
    (f) => record[f as keyof IngestRecord] != null
  ).length / fields.length;
  score += completeness;

  // Confidence from envelope
  score += record.envelope.confidence;

  // Normalize to 0-1
  return Math.min(1, score / 4);
}
