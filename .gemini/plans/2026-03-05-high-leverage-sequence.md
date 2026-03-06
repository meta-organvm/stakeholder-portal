# Implementation Plan: High-Leverage Sequence

## Overview
This plan outlines the implementation for the 7 high-leverage steps required for the stakeholder-portal, moving from in-memory processing to a distributed, persistent, and robust architecture.

## Sequence

### 1. Distributed Maintenance Locking
- **Goal:** Prevent concurrent cron/maintenance runs across multiple instance instances.
- **Action:** Replace `activeMaintenanceRun` in-memory promise with a DB-backed lock table (`maintenance_runs`).
- **Details:**
  - Create table `maintenance_runs` (id, status, started_at, completed_at, locked_by).
  - Use atomic updates/transactions to acquire the lock.
  - Convert `scorecards.ndjson` append to a DB insert into the run ledger.

### 2. Admin Authentication via OIDC/SSO
- **Goal:** Move admin auth from simple service tokens to real identity sessions.
- **Action:** Introduce an authentication provider (e.g., Auth.js / NextAuth).
- **Details:**
  - Restrict the `CRON_SECRET` / bearer token auth solely to machine-to-machine cron endpoints.
  - Implement OIDC/SSO login page and middleware for `/dashboard` and human-facing API routes.

### 3. Job Queue for Maintenance and Alerts
- **Goal:** Robust, asynchronous background jobs with retry and dead-letter tracking.
- **Action:** Replace inline `.map` or synchronous `dispatchAlertEscalations` with a job queue.
- **Details:**
  - Setup a lightweight queue (e.g., using Postgres `SKIP LOCKED` or a dedicated tool like Redis/BullMQ).
  - Enqueue maintenance tasks and alert dispatches.

### 4. Alert Delivery Audit and Escalation
- **Goal:** Track alert lifecycles and implement severity-time escalation policies.
- **Action:** Build an `alert_deliveries` tracking system.
- **Details:**
  - DB table for alerts (sent, failed, retried, acked).
  - Escalate unresolved critical alerts after timeout windows.

### 5. Omnipresence Connectors
- **Goal:** Incremental syncs for Slack, deployment telemetry, and project boards.
- **Action:** Add connectors with cursor-based pagination.
- **Details:**
  - Save sync cursors in DB to allow incremental fetching.

### 6. Durable Core Intelligence State
- **Goal:** Persist entity registry, graph, and metrics.
- **Action:** Move from process memory to Postgres + vector store + graph store.
- **Details:**
  - Implement Postgres schema for entities.
  - Setup pgvector (or separate vector DB) and graph representations.

### 7. CI Quality Gates
- **Goal:** Block regressions using eval thresholds.
- **Action:** Integrate `scripts/run-evals.ts` with CI pipelines.
- **Details:**
  - Check citation coverage, hallucination rate, and latency against configured thresholds.
  - Fail CI run if metrics are below baseline.

## Next Step
- Configure database connection (Postgres is implied by step 6, `pg` / `drizzle-orm` or Prisma) and migrate the first locking schema.
