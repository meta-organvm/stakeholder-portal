import { NextRequest, NextResponse } from "next/server";
import {
  getLatestPulse,
  getMetricTimeSeries,
  getDensityTimeSeries,
} from "@/lib/pulse-metrics";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint") || "latest";

  if (endpoint === "latest") {
    const pulse = await getLatestPulse();
    if (!pulse.snapshot) {
      return NextResponse.json({
        ok: false,
        stale: true,
        source: pulse.source,
      });
    }
    return NextResponse.json({
      ok: true,
      stale: pulse.stale,
      source: pulse.source,
      data: {
        density: pulse.snapshot.density,
        entities: pulse.snapshot.entities,
        edges: pulse.snapshot.edges,
        tensions: pulse.snapshot.tensions,
        clusters: pulse.snapshot.clusters,
        ammoi: pulse.snapshot.ammoiText,
        gateRates: pulse.snapshot.gateRates,
        organDensities: pulse.snapshot.organDensities,
        timestamp: pulse.snapshot.timestamp,
      },
    });
  }

  if (endpoint === "timeseries") {
    const metricId = searchParams.get("metric_id") || "met_total_repos";
    const entityId = searchParams.get("entity_id") || "system";
    const hours = parseInt(searchParams.get("hours") || "24", 10);
    const series = await getMetricTimeSeries(metricId, entityId, hours);
    return NextResponse.json({ ok: true, ...series });
  }

  if (endpoint === "density") {
    const hours = parseInt(searchParams.get("hours") || "168", 10);
    const series = await getDensityTimeSeries(hours);
    return NextResponse.json({ ok: true, points: series });
  }

  return NextResponse.json(
    { ok: false, error: `Unknown endpoint: ${endpoint}` },
    { status: 400 },
  );
}
