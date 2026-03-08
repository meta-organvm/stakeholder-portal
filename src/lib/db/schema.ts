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
  bigint,
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
    contentClass: text("content_class"), // 'vision' | 'research' | 'code' | 'config' | 'readme' | null
    embedding: vector("embedding", { dimensions: 384 }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(sql`to_tsvector('english', content)`),
    fileMtime: timestamp("file_mtime", { withTimezone: true }),
    commitSha: text("commit_sha"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    embeddingIndex: index("embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    searchIndex: index("search_idx").using("gin", table.searchVector),
    repoPathIndex: index("chunk_repo_path_idx").on(table.repo, table.path),
  })
);

// ─────────────────────────────────────────────
// Repository file trees (Phase 1A)
// ─────────────────────────────────────────────

export const fileTypeEnum = pgEnum("file_type", ["file", "directory"]);

export const repoFileTrees = pgTable(
  "repo_file_trees",
  {
    id: text("id").primaryKey(), // repo:path
    repo: text("repo").notNull(),
    organ: text("organ").notNull(),
    path: text("path").notNull(),
    fileType: fileTypeEnum("file_type").notNull(),
    extension: text("extension"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    lastModified: timestamp("last_modified", { withTimezone: true }),
    commitSha: text("commit_sha"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    repoIndex: index("file_tree_repo_idx").on(table.repo),
    extensionIndex: index("file_tree_ext_idx").on(table.extension),
    pathIndex: index("file_tree_path_idx").using("gin", sql`${table.path} gin_trgm_ops`),
  })
);

// ─────────────────────────────────────────────
// Code symbols (Phase 2A)
// ─────────────────────────────────────────────

export const symbolTypeEnum = pgEnum("symbol_type", [
  "function",
  "class",
  "interface",
  "type",
  "const",
]);

// ─────────────────────────────────────────────
// Planning Kanban (Styx operations calendar)
// ─────────────────────────────────────────────

export const planningStatusEnum = pgEnum("planning_status", [
  "not_started",
  "in_progress",
  "blocked",
  "done",
]);

export const planningItems = pgTable("planning_items", {
  id: text("id").primaryKey(), // e.g. "mar-eng-001"
  title: text("title").notNull(),
  description: text("description"),
  dept: text("dept").notNull(), // ENG, LEG, PRD, OPS, GRO, FIN, CXS, B2B
  owner: text("owner").notNull(), // AI, H:MN, H:LC, H:BD, H:RO, H:CR, H:FO
  month: text("month").notNull(), // "2026-03", "2026-04", etc.
  phase: text("phase").notNull(), // Beta, Gamma, Delta, Omega
  status: planningStatusEnum("status").notNull().default("not_started"),
  position: integer("position").notNull().default(0),
  issueUrl: text("issue_url"),
  blockedBy: text("blocked_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// Code symbols (Phase 2A)
// ─────────────────────────────────────────────

export const codeSymbols = pgTable(
  "code_symbols",
  {
    id: text("id").primaryKey(), // repo:path:type:name
    repo: text("repo").notNull(),
    organ: text("organ").notNull(),
    path: text("path").notNull(),
    symbolType: symbolTypeEnum("symbol_type").notNull(),
    name: text("name").notNull(),
    signature: text("signature"),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    docComment: text("doc_comment"),
    parentSymbol: text("parent_symbol"),
    visibility: text("visibility"), // 'export' | 'public' | 'private' | null
    embedding: vector("embedding", { dimensions: 384 }),
    commitSha: text("commit_sha"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    repoIndex: index("symbol_repo_idx").on(table.repo),
    nameIndex: index("symbol_name_idx").using("gin", sql`${table.name} gin_trgm_ops`),
    typeIndex: index("symbol_type_idx").on(table.symbolType),
    embeddingIndex: index("symbol_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  })
);

