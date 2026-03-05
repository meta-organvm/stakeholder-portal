import { timingSafeEqual } from "crypto";
import { getMaintenanceRunState, runMaintenanceCycle } from "@/lib/maintenance";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBearerToken(value: string | null): string | null {
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  return token || null;
}

function secretsMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, "utf-8");
  const providedBuf = Buffer.from(provided, "utf-8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function getProvidedCronSecret(request: Request): string | null {
  return (
    request.headers.get("x-cron-secret") ||
    parseBearerToken(request.headers.get("authorization")) ||
    null
  );
}

function getDefaultConnectorIds(): string[] | undefined {
  const raw = process.env.CRON_CONNECTOR_IDS;
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return json({ error: "CRON_SECRET is not configured" }, 503);
  }

  const provided = getProvidedCronSecret(request);
  if (!secretsMatch(expected, provided)) {
    return json({ error: "Unauthorized cron trigger" }, 401);
  }

  const runStateBefore = await getMaintenanceRunState();

  const url = new URL(request.url);
  const since = url.searchParams.get("since") || undefined;
  const connectorsParam = url.searchParams.get("connectors");
  const connectorIds = connectorsParam
    ? connectorsParam
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : getDefaultConnectorIds();

  const scorecard = await runMaintenanceCycle({
    incremental: true,
    since,
    connector_ids: connectorIds,
    run_retention: true,
    dispatch_alerts: true,
    persist_scorecard: true,
  });

  return json({
    status: "ok",
    scorecard_id: scorecard.id,
    shared_run: runStateBefore.running,
    active_run_id_before: runStateBefore.scorecard_id,
    health: scorecard.status,
    alerts: scorecard.alerts.length,
    critical_alerts: scorecard.alerts.filter((a) => a.severity === "critical").length,
    alert_dispatch: scorecard.alert_dispatch,
    completed_at: scorecard.completed_at,
  });
}
