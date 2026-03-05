/**
 * Maintenance cycle orchestration and scorecard persistence.
 */


import { runIngestionCycle, type IngestionCycleReport } from "./connectors/orchestrator";
import {
  runEvaluationSuite,
  type EvaluationReport,
  type EvaluationSample,
} from "./evaluation";
import { applyRetentionPolicies, type RetentionResult } from "./compliance";
import { getMetricsSnapshot, type MetricsSnapshot } from "./observability";
import { getAuditStats } from "./security";
import {
  evaluateSystemAlerts,
  getOverallAlertStatus,
  getAlertThresholds,
  type SystemAlert,
  type AlertThresholds,
} from "./alerts";
import {
  dispatchAlertEscalations,
  type AlertDispatchSummary,
} from "./alert-sinks";

export interface MaintenanceCycleOptions {
  incremental?: boolean;
  since?: string;
  connector_ids?: string[];
  evaluation_samples?: EvaluationSample[];
  run_retention?: boolean;
  dispatch_alerts?: boolean;
  persist_scorecard?: boolean;
}

export interface MaintenanceScorecard {
  id: string;
  started_at: string;
  completed_at: string;
  ingestion: IngestionCycleReport;
  retention: RetentionResult | null;
  evaluation: EvaluationReport | null;
  audit: ReturnType<typeof getAuditStats>;
  metrics: MetricsSnapshot;
  thresholds: AlertThresholds;
  alerts: SystemAlert[];
  alert_dispatch: AlertDispatchSummary;
  status: "healthy" | "degraded" | "critical";
}

export interface MaintenanceRunState {
  running: boolean;
  scorecard_id: string | null;
  started_at: string | null;
}

import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import { singletonLocks, maintenanceRuns } from "./db/schema";

export async function getMaintenanceRunState(): Promise<MaintenanceRunState> {
  const [lock] = await db.select().from(singletonLocks).where(eq(singletonLocks.name, "maintenance_run"));
  if (!lock) {
    return { running: false, scorecard_id: null, started_at: null };
  }

  const [activeRun] = await db.select().from(maintenanceRuns).where(eq(maintenanceRuns.id, lock.lockedBy));
  if (!activeRun) {
    return { running: false, scorecard_id: null, started_at: null };
  }

  return {
    running: true,
    scorecard_id: activeRun.id,
    started_at: activeRun.startedAt.toISOString(),
  };
}

export async function runMaintenanceCycle(
  options: MaintenanceCycleOptions = {}
): Promise<MaintenanceScorecard> {
  const startedAt = new Date().toISOString();
  const runId = `maint-${startedAt.replace(/[:.]/g, "-")}`;

  // Attempt to acquire lock via insert unique constraint
  let lockAcquired = false;
  try {
    await db.insert(singletonLocks).values({
      name: "maintenance_run",
      lockedBy: runId,
      lockedAt: new Date(),
    });
    lockAcquired = true;
  } catch (err: unknown) {
    const error = err as { code?: string };
    // Postgres unique constraint violation
    if (error.code === '23505') {
       return null as unknown as MaintenanceScorecard; // Cannot run, already running
    }
    throw err;
  }

  if (!lockAcquired) {
    // This branch should ideally not be reached if the catch block handles all non-acquisition cases
    // by either returning or re-throwing. However, keeping it for robustness if other errors occur
    // that don't lead to a return/throw in the catch.
    throw new Error("Maintenance cycle could not acquire lock for an unknown reason.");
  }

  // Insert ledger entry
  await db.insert(maintenanceRuns).values({
    id: runId,
    status: "running",
    startedAt: new Date(startedAt),
  });

  try {
    const ingestion = await runIngestionCycle({
      incremental: options.incremental,
      since: options.since,
      connector_ids: options.connector_ids,
      persist_dead_letters: true,
    });

    const retention =
      options.run_retention === false ? null : applyRetentionPolicies();
    const evaluation =
      options.evaluation_samples && options.evaluation_samples.length > 0
        ? runEvaluationSuite(options.evaluation_samples)
        : null;

    const audit = getAuditStats();
    const metrics = getMetricsSnapshot();
    const thresholds = getAlertThresholds();
    const alerts = evaluateSystemAlerts(
      {
        evaluation: evaluation?.summary ?? null,
        ingestion,
        audit,
        metrics,
      },
      thresholds
    );
    const status = getOverallAlertStatus(alerts);
    const completedAt = new Date().toISOString();
    const alertDispatch =
      options.dispatch_alerts === false
        ? { attempted: 0, delivered: 0, results: [] }
        : await dispatchAlertEscalations({
            status,
            scorecard_id: runId,
            completed_at: completedAt,
            alerts,
          });

    const scorecard: MaintenanceScorecard = {
      id: runId,
      started_at: startedAt,
      completed_at: completedAt,
      ingestion,
      retention,
      evaluation,
      audit,
      metrics,
      thresholds,
      alerts,
      alert_dispatch: alertDispatch,
      status,
    };

    if (options.persist_scorecard !== false) {
      await db.update(maintenanceRuns).set({
        completedAt: new Date(completedAt),
        status: status,
        scorecard: scorecard,
      }).where(eq(maintenanceRuns.id, runId));
    }

    return scorecard;
  } catch (error) {
    if (options.persist_scorecard !== false) {
      await db.update(maintenanceRuns).set({
        completedAt: new Date(),
        status: "failed",
      }).where(eq(maintenanceRuns.id, runId));
    }
    throw error;
  } finally {
    await db.delete(singletonLocks).where(eq(singletonLocks.name, "maintenance_run"));
  }
}

export async function readRecentMaintenanceScorecards(limit = 20): Promise<MaintenanceScorecard[]> {
  const rows = await db
    .select({ scorecard: maintenanceRuns.scorecard })
    .from(maintenanceRuns)
    .orderBy(desc(maintenanceRuns.startedAt))
    .limit(limit);

  return rows
    .map(row => row.scorecard as unknown as MaintenanceScorecard)
    .filter(Boolean);
}

