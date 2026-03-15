import { db } from "@/lib/db";
import { pulseSnapshots, metricObservations } from "@/lib/db/pulse-schema";
import { desc, eq, and, gte } from "drizzle-orm";
import type { PulseSnapshot } from "@/lib/db/pulse-schema";

export interface LatestPulse {
  snapshot: PulseSnapshot | null;
  stale: boolean;
  source: "neon" | "snapshot";
}

export interface MetricTimeSeries {
  metricId: string;
  entityId: string;
  points: { timestamp: string; value: number }[];
}

export async function getLatestPulse(): Promise<LatestPulse> {
  try {
    const rows = await db
      .select()
      .from(pulseSnapshots)
      .orderBy(desc(pulseSnapshots.timestamp))
      .limit(1);
    if (rows.length === 0) {
      return { snapshot: null, stale: true, source: "neon" };
    }
    const snapshot = rows[0];
    const age = Date.now() - new Date(snapshot.timestamp).getTime();
    const stale = age > 30 * 60 * 1000;
    return { snapshot, stale, source: "neon" };
  } catch {
    return { snapshot: null, stale: true, source: "snapshot" };
  }
}

export async function getMetricTimeSeries(
  metricId: string,
  entityId: string = "system",
  hours: number = 24,
): Promise<MetricTimeSeries> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({
        timestamp: metricObservations.timestamp,
        value: metricObservations.value,
      })
      .from(metricObservations)
      .where(
        and(
          eq(metricObservations.metricId, metricId),
          eq(metricObservations.entityId, entityId),
          gte(metricObservations.timestamp, since),
        ),
      )
      .orderBy(metricObservations.timestamp)
      .limit(200);
    return {
      metricId,
      entityId,
      points: rows.map((r) => ({
        timestamp: r.timestamp.toISOString(),
        value: r.value,
      })),
    };
  } catch {
    return { metricId, entityId, points: [] };
  }
}

export async function getDensityTimeSeries(
  hours: number = 168,
): Promise<{ timestamp: string; density: number }[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({
        timestamp: pulseSnapshots.timestamp,
        density: pulseSnapshots.density,
      })
      .from(pulseSnapshots)
      .where(gte(pulseSnapshots.timestamp, since))
      .orderBy(pulseSnapshots.timestamp)
      .limit(500);
    return rows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      density: r.density,
    }));
  } catch {
    return [];
  }
}
