import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  pgEnum,
  index,
  vector,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────
// Distributed lock registry
// ─────────────────────────────────────────────
export const singletonLocks = pgTable("singleton_locks", {
  name: text("name").primaryKey(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  lockedBy: text("locked_by").notNull(),
});

// ─────────────────────────────────────────────
// Maintenance run ledger
// ─────────────────────────────────────────────
export const maintenanceRuns = pgTable("maintenance_runs", {
  id: text("id").primaryKey(),
  status: text("status").notNull(), // 'running' | 'healthy' | 'degraded' | 'critical' | 'failed'
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  scorecard: jsonb("scorecard"),
});

// ─────────────────────────────────────────────
// Job queue (Postgres SKIP LOCKED based)
// ─────────────────────────────────────────────

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "done",
  "failed",
  "dead_letter",
]);

export const jobTypeEnum = pgEnum("job_type", [
  "maintenance_cycle",
  "alert_dispatch",
  "connector_sync",
  "retention",
]);

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  type: jobTypeEnum("type").notNull(),
  status: jobStatusEnum("status").notNull().default("pending"),
  payload: jsonb("payload"),
  result: jsonb("result"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  workerId: text("worker_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// Alert delivery audit
// ─────────────────────────────────────────────

export const alertDeliveryStatusEnum = pgEnum("alert_delivery_status", [
  "sent",
  "failed",
  "retried",
  "acked",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warning",
  "critical",
]);

export const alertDeliveries = pgTable("alert_deliveries", {
  id: text("id").primaryKey(),
  scorecardId: text("scorecard_id"),
  alertId: text("alert_id").notNull(),
  alertCode: text("alert_code").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  sink: text("sink").notNull(), // 'slack' | 'webhook' | 'email'
  status: alertDeliveryStatusEnum("status").notNull().default("sent"),
  attempts: integer("attempts").notNull().default(1),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// Escalation policies
// ─────────────────────────────────────────────

export const escalationPolicies = pgTable("escalation_policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  unackedAfterSeconds: integer("unacked_after_seconds").notNull().default(3600),
  escalateTo: text("escalate_to").notNull(), // 'slack' | 'email' | 'pagerduty'
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// Connector sync cursors (Step 5)
// ─────────────────────────────────────────────

export const connectorCursors = pgTable("connector_cursors", {
  connectorId: text("connector_id").primaryKey(),
  cursor: text("cursor"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  totalSynced: integer("total_synced").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// Document Embeddings (Phase 2 Vector Store)
// ─────────────────────────────────────────────

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    organ: text("organ").notNull(),
    path: text("path").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(sql`to_tsvector('english', content)`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    embeddingIndex: index("embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    searchIndex: index("search_idx").using("gin", table.searchVector),
    repoPathIndex: index("chunk_repo_path_idx").on(table.repo, table.path),
  })
);

