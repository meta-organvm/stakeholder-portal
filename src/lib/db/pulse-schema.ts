import { pgTable, serial, real, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────
// Pulse metrics tables (read-only from portal)
// Written by Python engine's neon_sink.py via raw SQL
// ─────────────────────────────────────────────

export const pulseSnapshots = pgTable("pulse_snapshots", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  density: real("density").notNull(),
  entities: integer("entities").notNull(),
  edges: integer("edges").notNull(),
  tensions: integer("tensions").notNull(),
  clusters: integer("clusters").notNull(),
  ammoiText: text("ammoi_text").notNull(),
  gateRates: jsonb("gate_rates").$type<Record<string, number>>(),
  organDensities: jsonb("organ_densities").$type<Record<string, number>>(),
});

export const metricObservations = pgTable(
  "metric_observations",
  {
    id: serial("id").primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    metricId: text("metric_id").notNull(),
    entityId: text("entity_id").notNull(),
    value: real("value").notNull(),
    source: text("source").notNull().default("pulse"),
  },
  (table) => [
    index("idx_observations_metric_ts").on(table.metricId, table.timestamp),
  ],
);

export type PulseSnapshot = typeof pulseSnapshots.$inferSelect;
export type MetricObservation = typeof metricObservations.$inferSelect;
