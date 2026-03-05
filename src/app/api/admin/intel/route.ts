import {
  buildAccessContext,
  evaluateAccess,
  getAuditStats,
  logAudit,
  type AccessContext,
  type Role,
} from "@/lib/security";
import { timingSafeEqual } from "crypto";
import { getMetricsSnapshot } from "@/lib/observability";
import { runIngestionCycle } from "@/lib/connectors/orchestrator";
import { applyRetentionPolicies, deleteSubjectData, exportSubjectData } from "@/lib/compliance";
import { runEvaluationSuite, type EvaluationSample } from "@/lib/evaluation";
import { getFeedbackStats } from "@/lib/feedback";
import {
  getMaintenanceRunState,
  runMaintenanceCycle,
  readRecentMaintenanceScorecards,
} from "@/lib/maintenance";
import { evaluateSystemAlerts, getOverallAlertStatus } from "@/lib/alerts";
import { getAdminSessionFromRequest, validateAdminCsrf } from "@/lib/admin-auth";

type SupportedAction =
  | "run_ingestion_cycle"
  | "apply_retention"
  | "run_eval"
  | "run_maintenance_cycle"
  | "export_subject_data"
  | "delete_subject_data";

const VALID_ROLES: Role[] = ["public", "stakeholder", "contributor", "admin"];
const MAX_CONNECTOR_IDS = 25;
const MAX_EVAL_SAMPLES = 500;

interface ResolvedIdentity {
  role: Role;
  user_id: string | null;
  auth_method: "session" | "token";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readTokenFromRequest(request: Request): string | null {
  return request.headers.get("x-admin-token")?.trim() || null;
}

function safeStringEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf-8");
  const rightBuf = Buffer.from(right, "utf-8");
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

function getRequestRole(request: Request): Role {
  const raw = request.headers.get("x-portal-role")?.trim().toLowerCase() || "public";
  return (VALID_ROLES.includes(raw as Role) ? raw : "public") as Role;
}

function getContextWithIdentity(request: Request, identity: ResolvedIdentity): AccessContext {
  const context = buildAccessContext(request, identity.role);
  return {
    ...context,
    user_id: identity.user_id,
    attributes: {
      ...context.attributes,
      auth_method: identity.auth_method,
    },
  };
}

function authorize(request: Request):
  | { ok: true; identity: ResolvedIdentity }
  | { ok: false; response: Response } {
  const session = getAdminSessionFromRequest(request);
  if (session) {
    return {
      ok: true,
      identity: {
        role: session.role,
        user_id: session.user_id,
        auth_method: "session",
      },
    };
  }

  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    return {
      ok: false,
      response: json(
        { error: "No valid admin session and ADMIN_API_TOKEN is not configured" },
        503
      ),
    };
  }
  const providedToken = readTokenFromRequest(request);
  if (!providedToken || !safeStringEqual(providedToken, expected)) {
    return {
      ok: false,
      response: json({ error: "Unauthorized" }, 401),
    };
  }
  return {
    ok: true,
    identity: {
      role: getRequestRole(request),
      user_id: request.headers.get("x-client-id")?.trim() || "token-admin",
      auth_method: "token",
    },
  };
}

function authorizeAction(
  request: Request,
  resource: string,
  action: "read" | "write" | "delete" | "admin",
  auditAction: string
): { ok: true; context: AccessContext } | { ok: false; response: Response } {
  const authn = authorize(request);
  if (!authn.ok) return authn;

  if (authn.identity.auth_method === "session" && action !== "read") {
    const csrfValid = validateAdminCsrf(request);
    if (!csrfValid) {
      const deniedContext = getContextWithIdentity(request, authn.identity);
      logAudit(
        `${auditAction}_csrf`,
        resource,
        deniedContext,
        false,
        "csrf_validation_failed"
      );
      return {
        ok: false,
        response: json({ error: "Forbidden", reason: "csrf_validation_failed" }, 403),
      };
    }
  }

  const ctx = getContextWithIdentity(request, authn.identity);
  const access = evaluateAccess(ctx, resource, action);
  logAudit(auditAction, resource, ctx, access.allowed, access.reason);
  if (!access.allowed) {
    return {
      ok: false,
      response: json({ error: "Forbidden", reason: access.reason }, 403),
    };
  }
  return { ok: true, context: ctx };
}

function parseConnectorIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, MAX_CONNECTOR_IDS);
  return ids;
}

function parseEvaluationSamples(value: unknown): EvaluationSample[] | null {
  if (!Array.isArray(value)) return null;
  const samples = value
    .slice(0, MAX_EVAL_SAMPLES)
    .filter((sample): sample is EvaluationSample => {
      if (typeof sample !== "object" || sample === null) return false;
      const typed = sample as Record<string, unknown>;
      return (
        typeof typed.id === "string" &&
        typeof typed.query === "string" &&
        typeof typed.response === "string" &&
        Array.isArray(typed.citations)
      );
    });
  return samples;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const operation = (url.searchParams.get("op") || "metrics").trim();

  if (operation === "metrics") {
    const auth = authorizeAction(request, "metrics", "read", "admin_metrics_read");
    if (!auth.ok) return auth.response;
    const audit = getAuditStats();
    const alerts = evaluateSystemAlerts({ audit });
    return json({
      metrics: getMetricsSnapshot(),
      feedback: getFeedbackStats(),
      audit,
      maintenance_run: await getMaintenanceRunState(),
      alerts,
      alert_status: getOverallAlertStatus(alerts),
    });
  }

  if (operation === "scorecards") {
    const auth = authorizeAction(request, "metrics", "read", "admin_scorecards_read");
    if (!auth.ok) return auth.response;
    const limitRaw = url.searchParams.get("limit");
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 10;
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 10;
    return json({
      scorecards: await readRecentMaintenanceScorecards(limit),
    });
  }

  if (operation === "health") {
    const auth = authorizeAction(request, "metrics", "read", "admin_health_read");
    if (!auth.ok) return auth.response;
    const latest = (await readRecentMaintenanceScorecards(1))[0] ?? null;
    if (latest) {
      return json({
        status: latest.status,
        alerts: latest.alerts,
        scorecard_id: latest.id,
        completed_at: latest.completed_at,
        maintenance_run: await getMaintenanceRunState(),
      });
    }
    const audit = getAuditStats();
    const alerts = evaluateSystemAlerts({ audit });
    return json({
      status: getOverallAlertStatus(alerts),
      alerts,
      scorecard_id: null,
      maintenance_run: await getMaintenanceRunState(),
    });
  }

  return json({ error: `Unsupported op: ${operation}` }, 400);
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return json({ error: "Request body must be an object" }, 400);
  }

  const action = (body as { action?: unknown }).action;
  if (typeof action !== "string") {
    return json({ error: "Missing action" }, 400);
  }

  const typedAction = action as SupportedAction;
  switch (typedAction) {
    case "run_ingestion_cycle": {
      const auth = authorizeAction(request, "graph", "write", "admin_run_ingestion_cycle");
      if (!auth.ok) return auth.response;
      const connectorIds = parseConnectorIds((body as { connector_ids?: unknown }).connector_ids);
      const incremental = Boolean((body as { incremental?: unknown }).incremental);
      const since = (body as { since?: unknown }).since;
      const report = await runIngestionCycle({
        incremental,
        since: typeof since === "string" ? since : undefined,
        connector_ids: connectorIds ?? undefined,
        persist_dead_letters: true,
      });
      return json({ status: "ok", report });
    }

    case "apply_retention": {
      const auth = authorizeAction(request, "metrics", "admin", "admin_apply_retention");
      if (!auth.ok) return auth.response;
      const result = applyRetentionPolicies();
      return json({ status: "ok", result });
    }

    case "run_eval": {
      const auth = authorizeAction(request, "metrics", "write", "admin_run_eval");
      if (!auth.ok) return auth.response;
      const samples = parseEvaluationSamples((body as { samples?: unknown }).samples);
      if (!samples || samples.length === 0) {
        return json({ error: "samples must be a non-empty array" }, 400);
      }
      const report = runEvaluationSuite(samples);
      return json({ status: "ok", report });
    }

    case "run_maintenance_cycle": {
      const auth = authorizeAction(
        request,
        "metrics",
        "admin",
        "admin_run_maintenance_cycle"
      );
      if (!auth.ok) return auth.response;
      const connectorIds = parseConnectorIds((body as { connector_ids?: unknown }).connector_ids);
      const incremental = Boolean((body as { incremental?: unknown }).incremental);
      const runRetention = (body as { run_retention?: unknown }).run_retention;
      const since = (body as { since?: unknown }).since;
      const samples = parseEvaluationSamples((body as { samples?: unknown }).samples);

      const scorecard = await runMaintenanceCycle({
        incremental,
        since: typeof since === "string" ? since : undefined,
        connector_ids: connectorIds ?? undefined,
        evaluation_samples: samples ?? undefined,
        run_retention: typeof runRetention === "boolean" ? runRetention : true,
        persist_scorecard: true,
      });
      return json({ status: "ok", scorecard });
    }

    case "export_subject_data": {
      const auth = authorizeAction(request, "feedback", "read", "admin_export_subject");
      if (!auth.ok) return auth.response;
      const clientId = (body as { client_id?: unknown }).client_id;
      if (typeof clientId !== "string" || !clientId.trim()) {
        return json({ error: "client_id is required" }, 400);
      }
      return json({ status: "ok", result: exportSubjectData(clientId.trim()) });
    }

    case "delete_subject_data": {
      const auth = authorizeAction(request, "feedback", "delete", "admin_delete_subject");
      if (!auth.ok) return auth.response;
      const clientId = (body as { client_id?: unknown }).client_id;
      if (typeof clientId !== "string" || !clientId.trim()) {
        return json({ error: "client_id is required" }, 400);
      }
      return json({ status: "ok", result: deleteSubjectData(clientId.trim()) });
    }

    default:
      return json({ error: `Unsupported action: ${action}` }, 400);
  }
}
