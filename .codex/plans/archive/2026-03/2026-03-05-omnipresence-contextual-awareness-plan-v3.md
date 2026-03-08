# Stakeholder Portal Omnipresence + Omnipotence Plan (Execution Update v3)

Date: 2026-03-05  
Scope: `stakeholder-portal`  
Reference chain:
1. `2026-03-05-omnipresence-contextual-awareness-plan.md`
2. `2026-03-05-omnipresence-contextual-awareness-plan-v2.md`

## Increment Objective

Operationalize prior WS-A..WS-G backend capabilities through a guarded admin control-plane endpoint so ingestion, eval, and compliance actions can be executed on demand.

## Implemented in v3

1. Added admin intelligence API route:
   - `src/app/api/admin/intel/route.ts`
2. Added token + role-gated authorization for operations:
   - header token gate: `x-admin-token` vs `ADMIN_API_TOKEN`
   - role gate: `x-portal-role` with RBAC/ABAC checks
3. Added operable actions:
   - `run_ingestion_cycle`
   - `apply_retention`
   - `run_eval`
   - `export_subject_data`
   - `delete_subject_data`
4. Added metrics read endpoint:
   - `GET /api/admin/intel?op=metrics`
5. Added full route test coverage:
   - `tests/admin-intel-route.test.ts`
6. Updated runtime docs:
   - `README.md` admin API + token documentation

## Validation

1. `npm test`: 22 files, 139 tests passing.
2. `npm run lint`: clean.
3. `npx tsc --noEmit`: clean.
4. `npm run build`: successful (includes `/api/admin/intel` route).

## Operational Note

This endpoint is intentionally fail-closed:
1. If `ADMIN_API_TOKEN` is missing, it returns `503`.
2. Invalid token returns `401`.
3. Valid token but insufficient role/permission returns `403`.
