"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface ApiState {
  loading: boolean;
  error: string | null;
  last_response: string;
}

interface SessionState {
  loading: boolean;
  authenticated: boolean;
  role: string | null;
  user_id: string | null;
  csrf_token: string | null;
  error: string | null;
}

const DEFAULT_EVAL_SAMPLES = JSON.stringify(
  [
    {
      id: "admin-ui-sample-1",
      query: "How many repos are in ORGANVM?",
      response: "ORGANVM currently tracks 103 repositories [cite-1].",
      citations: [
        {
          id: "cite-1",
          source_name: "Manifest",
          source_type: "manifest",
          url: null,
          relevance: 1,
          confidence: 0.92,
          freshness: 0.8,
          freshness_label: "fresh",
          snippet: "Manifest snapshot",
          retrieved_at: "2026-03-05T00:00:00.000Z",
        },
      ],
      latency_ms: 500,
    },
  ],
  null,
  2
);

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AdminIntelPanel() {
  const [subjectId, setSubjectId] = useState("");
  const [evalSamplesText, setEvalSamplesText] = useState(DEFAULT_EVAL_SAMPLES);
  const [apiState, setApiState] = useState<ApiState>({
    loading: false,
    error: null,
    last_response: "",
  });
  const [session, setSession] = useState<SessionState>({
    loading: true,
    authenticated: false,
    role: null,
    user_id: null,
    csrf_token: null,
    error: null,
  });

  async function refreshSession(): Promise<void> {
    setSession((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/api/admin/session", {
        method: "GET",
      });
      const payload = await res.json();
      if (!res.ok) {
        setSession({
          loading: false,
          authenticated: false,
          role: null,
          user_id: null,
          csrf_token: null,
          error: payload?.error || "Session unavailable",
        });
        return;
      }

      setSession({
        loading: false,
        authenticated: Boolean(payload.authenticated),
        role: payload?.session?.role ?? null,
        user_id: payload?.session?.user_id ?? null,
        csrf_token: payload?.session?.csrf_token ?? null,
        error: null,
      });
    } catch (error) {
      setSession({
        loading: false,
        authenticated: false,
        role: null,
        user_id: null,
        csrf_token: null,
        error: error instanceof Error ? error.message : "Failed to read session",
      });
    }
  }

  useEffect(() => {
    // Fetch-on-mount: refreshSession is async (no synchronous setState)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, setState on completion only
    void refreshSession();
  }, []);

  async function requestGet(op: string): Promise<void> {
    setApiState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/admin/intel?op=${encodeURIComponent(op)}`, {
        method: "GET",
      });
      const payload = await res.json();
      if (!res.ok) {
        setApiState({
          loading: false,
          error: payload?.error || `GET ${op} failed (${res.status})`,
          last_response: pretty(payload),
        });
        return;
      }
      setApiState({
        loading: false,
        error: null,
        last_response: pretty(payload),
      });
    } catch (error) {
      setApiState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown request error",
        last_response: "",
      });
    }
  }

  async function requestPost(action: string, payload: Record<string, unknown> = {}): Promise<void> {
    setApiState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (session.csrf_token) {
        headers["x-admin-csrf"] = session.csrf_token;
      }
      const res = await fetch("/api/admin/intel", {
        method: "POST",
        headers,
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) {
        setApiState({
          loading: false,
          error: body?.error || `${action} failed (${res.status})`,
          last_response: pretty(body),
        });
        return;
      }
      setApiState({
        loading: false,
        error: null,
        last_response: pretty(body),
      });
    } catch (error) {
      setApiState({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown request error",
        last_response: "",
      });
    }
  }

  async function logout(): Promise<void> {
    setApiState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      await fetch("/api/admin/session", { method: "DELETE" });
      setApiState({
        loading: false,
        error: null,
        last_response: "// Logged out",
      });
      await refreshSession();
      window.location.href = "/admin/login";
    } catch (error) {
      setApiState({
        loading: false,
        error: error instanceof Error ? error.message : "Logout failed",
        last_response: "",
      });
    }
  }

  function runEval(): void {
    let samples: unknown;
    try {
      samples = JSON.parse(evalSamplesText);
    } catch {
      setApiState((prev) => ({
        ...prev,
        error: "Eval samples must be valid JSON.",
      }));
      return;
    }
    void requestPost("run_eval", { samples });
  }

  if (session.loading) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-muted)]">
        Loading admin session...
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-lg font-semibold">Authentication Required</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          {session.error || "No active admin session."}
        </p>
        <div className="mt-4">
          <Link
            href="/admin/login"
            className="rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white"
          >
            Go To Admin Login
          </Link>
        </div>
      </div>
    );
  }

  const subjectPayload = subjectId.trim() ? { client_id: subjectId.trim() } : {};

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Authenticated Session</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              role: <span className="text-[var(--color-text)]">{session.role}</span> | user:{" "}
              <span className="text-[var(--color-text)]">{session.user_id}</span>
            </p>
          </div>
          <button
            onClick={() => void logout()}
            disabled={apiState.loading}
            className="rounded border border-[var(--color-border)] px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="text-base font-semibold">Read Ops</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void requestGet("metrics")}
              disabled={apiState.loading}
              className="rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              Load Metrics
            </button>
            <button
              onClick={() => void requestGet("health")}
              disabled={apiState.loading}
              className="rounded border border-[var(--color-border)] px-3 py-2 text-xs font-medium disabled:opacity-50"
            >
              Load Health
            </button>
            <button
              onClick={() => void requestGet("scorecards")}
              disabled={apiState.loading}
              className="rounded border border-[var(--color-border)] px-3 py-2 text-xs font-medium disabled:opacity-50"
            >
              Load Scorecards
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="text-base font-semibold">Write Ops</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void requestPost("run_ingestion_cycle", { incremental: true })}
              disabled={apiState.loading}
              className="rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              Run Ingestion Cycle
            </button>
            <button
              onClick={() => void requestPost("run_maintenance_cycle", { incremental: true })}
              disabled={apiState.loading}
              className="rounded bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              Run Maintenance Cycle
            </button>
            <button
              onClick={() => void requestPost("apply_retention")}
              disabled={apiState.loading}
              className="rounded border border-[var(--color-border)] px-3 py-2 text-xs font-medium disabled:opacity-50"
            >
              Apply Retention
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h3 className="text-base font-semibold">Eval Runner</h3>
        <textarea
          value={evalSamplesText}
          onChange={(e) => setEvalSamplesText(e.target.value)}
          rows={10}
          className="mt-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--color-accent)]"
        />
        <div className="mt-3">
          <button
            onClick={runEval}
            disabled={apiState.loading}
            className="rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Run Eval Suite
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h3 className="text-base font-semibold">Subject Data Controls</h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            placeholder="client_id"
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={() => void requestPost("export_subject_data", subjectPayload)}
            disabled={apiState.loading || !subjectId.trim()}
            className="rounded border border-[var(--color-border)] px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            Export Subject
          </button>
          <button
            onClick={() => void requestPost("delete_subject_data", subjectPayload)}
            disabled={apiState.loading || !subjectId.trim()}
            className="rounded bg-red-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            Delete Subject
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h3 className="text-base font-semibold">Last Response</h3>
        {apiState.loading ? (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">Running request...</p>
        ) : null}
        {apiState.error ? (
          <p className="mt-3 text-sm text-red-400">{apiState.error}</p>
        ) : null}
        <pre className="mt-3 max-h-[24rem] overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs leading-relaxed">
          {apiState.last_response || "// No response yet"}
        </pre>
      </div>
    </div>
  );
}
