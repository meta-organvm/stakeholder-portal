/**
 * Connector interface contracts.
 *
 * Every source connector implements ConnectorAdapter, producing
 * IngestRecord objects for the ingestion pipeline.
 */

import type { EntityClass, ContextEnvelope } from "../ontology";

// ---------------------------------------------------------------------------
// Ingest record — the universal unit produced by connectors
// ---------------------------------------------------------------------------

export interface IngestRecord {
  /** Deterministic dedup key (connector + source-specific ID). */
  dedup_key: string;
  /** Which entity class this record describes. */
  entity_class: EntityClass;
  /** Proposed entity name. */
  name: string;
  /** Optional display name override. */
  display_name?: string;
  /** Description text. */
  description: string;
  /** Entity-class-specific attributes. */
  attributes: Record<string, unknown>;
  /** Provenance envelope. */
  envelope: ContextEnvelope;
  /** Known aliases for this entity. */
  aliases?: string[];
  /** Proposed relationships (source_hint → target_hint). */
  relationships?: Array<{
    type: string;
    target_hint: string;
    strength?: number;
    evidence?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Connector adapter interface
// ---------------------------------------------------------------------------

export interface ConnectorConfig {
  /** Unique connector identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Whether the connector is currently enabled. */
  enabled: boolean;
  /** Connector-specific settings. */
  settings: Record<string, unknown>;
}

export type ConnectorStatus = "idle" | "running" | "error" | "completed";

export interface ConnectorState {
  status: ConnectorStatus;
  last_run: string | null;
  records_ingested: number;
  errors: number;
  last_error: string | null;
}

export interface ConnectorAdapter {
  /** Connector identifier. */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;

  /** Initialize the connector with config. */
  configure(config: ConnectorConfig): void;

  /** Run a full or incremental sync. Returns ingest records. */
  sync(options?: { incremental?: boolean; since?: string }): Promise<IngestRecord[]>;

  /** Get current connector state. */
  getState(): ConnectorState;

  /** Process a webhook payload (for event-driven connectors). */
  handleWebhook?(payload: unknown): Promise<IngestRecord[]>;
}

// ---------------------------------------------------------------------------
// Connector registry
// ---------------------------------------------------------------------------

const connectors = new Map<string, ConnectorAdapter>();

export function registerConnector(adapter: ConnectorAdapter): void {
  connectors.set(adapter.id, adapter);
}

export function getConnector(id: string): ConnectorAdapter | undefined {
  return connectors.get(id);
}

export function listConnectors(): ConnectorAdapter[] {
  return [...connectors.values()];
}
