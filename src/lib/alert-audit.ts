/**
 * Alert delivery audit — persists per-sink delivery events to Postgres.
 * Also implements time-based escalation: if a critical/warning alert has
 * not been acked within the policy window, it is re-dispatched to the
 * escalation channel.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./db";
import { alertDeliveries, escalationPolicies } from "./db/schema";
import type { SystemAlert } from "./alerts";

export type AlertSink = "slack" | "webhook" | "email";

export interface AlertDeliveryRecord {
  id: string;
  scorecardId: string | null | undefined;
  alertId: string;
  alertCode: string;
  severity: "info" | "warning" | "critical";
  sink: AlertSink;
  status: "sent" | "failed" | "retried" | "acked";
  attempts: number;
  errorMessage?: string | null;
  payload?: unknown;
}

/** Record a successful alert delivery. */
export async function recordAlertSent(
  alert: SystemAlert,
  sink: AlertSink,
  scorecardId?: string,
  payload?: unknown
): Promise<string> {
  const id = randomUUID();
  await db.insert(alertDeliveries).values({
    id,
    scorecardId: scorecardId ?? null,
    alertId: alert.id,
    alertCode: alert.metric_name,
    severity: alert.severity as "info" | "warning" | "critical",
    sink,
    status: "sent",
    attempts: 1,
    lastAttemptAt: new Date(),
    payload: payload ?? null,
    createdAt: new Date(),
  });
  return id;
}

/** Record a failed alert delivery attempt. Updates attempts and error. */
export async function recordAlertFailed(
  alert: SystemAlert,
  sink: AlertSink,
  errorMessage: string,
  scorecardId?: string,
  payload?: unknown
): Promise<string> {
  const id = randomUUID();
  await db.insert(alertDeliveries).values({
    id,
    scorecardId: scorecardId ?? null,
    alertId: alert.id,
    alertCode: alert.metric_name,
    severity: alert.severity as "info" | "warning" | "critical",
    sink,
    status: "failed",
    attempts: 1,
    lastAttemptAt: new Date(),
    errorMessage,
    payload: payload ?? null,
    createdAt: new Date(),
  });
  return id;
}

/** Mark an existing delivery record as retried (increment attempts). */
export async function recordAlertRetried(
  deliveryId: string,
  succeeded: boolean,
  errorMessage?: string
): Promise<void> {
  await db.update(alertDeliveries)
    .set({
      status: succeeded ? "sent" : "retried",
      attempts: sql`${alertDeliveries.attempts} + 1`,
      lastAttemptAt: new Date(),
      errorMessage: errorMessage ?? null,
    })
    .where(eq(alertDeliveries.id, deliveryId));
}

/** Acknowledge a delivery — marks it as acked so escalation rules skip it. */
export async function ackAlertDelivery(deliveryId: string): Promise<void> {
  await db.update(alertDeliveries)
    .set({ status: "acked", ackedAt: new Date() })
    .where(eq(alertDeliveries.id, deliveryId));
}

/** Find all unacked alert deliveries that have exceeded the escalation window. */
export async function findEscalationCandidates(): Promise<
  Array<{
    deliveryId: string;
    alertCode: string;
    severity: "info" | "warning" | "critical";
    escalateTo: string;
  }>
> {
  const policies = await db
    .select()
    .from(escalationPolicies)
    .where(eq(escalationPolicies.enabled, true));

  if (!policies.length) return [];

  const results: Array<{
    deliveryId: string;
    alertCode: string;
    severity: "info" | "warning" | "critical";
    escalateTo: string;
  }> = [];

  for (const policy of policies) {
    const cutoff = new Date(Date.now() - policy.unackedAfterSeconds * 1000);
    const unacked = await db
      .select({
        id: alertDeliveries.id,
        alertCode: alertDeliveries.alertCode,
        severity: alertDeliveries.severity,
      })
      .from(alertDeliveries)
      .where(
        and(
          eq(alertDeliveries.severity, policy.severity),
          isNull(alertDeliveries.ackedAt),
          lt(alertDeliveries.createdAt, cutoff),
        )
      );

    for (const row of unacked) {
      results.push({
        deliveryId: row.id,
        alertCode: row.alertCode,
        severity: row.severity as "info" | "warning" | "critical",
        escalateTo: policy.escalateTo,
      });
    }
  }

  return results;
}

/** Seed default escalation policies (idempotent). */
export async function seedEscalationPolicies(): Promise<void> {
  const defaults = [
    {
      id: "policy-critical-1h",
      name: "Critical — escalate after 1 hour",
      severity: "critical" as const,
      unackedAfterSeconds: 3600,
      escalateTo: "email",
      enabled: true,
    },
    {
      id: "policy-warning-4h",
      name: "Warning — escalate after 4 hours",
      severity: "warning" as const,
      unackedAfterSeconds: 14400,
      escalateTo: "slack",
      enabled: true,
    },
  ];

  for (const policy of defaults) {
    await db
      .insert(escalationPolicies)
      .values({ ...policy, createdAt: new Date() })
      .onConflictDoNothing();
  }
}

/** Return recent delivery audit records. */
export async function getRecentAlertDeliveries(limit = 100) {
  return db
    .select()
    .from(alertDeliveries)
    .orderBy(alertDeliveries.createdAt)
    .limit(limit);
}
