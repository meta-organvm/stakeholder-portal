# Implementation Plan: Stakeholder Portal Completion (Alpha to Omega)

This plan outlines the steps to address the seven remaining gaps in the STAKEHOLDER PORTAL project, ensuring it moves from a functional backend to a polished, production-ready product.

## User Review Required

> [!IMPORTANT]
> - **Ingestion Engine**: I will be committing the `src/lib/ingestion/` directory and finalizing the `ingest-worker.ts` refactor.
> - **UI Redesign**: The "Ask Page" UI will be significantly updated to match the premium glassmorphic theme from the `ORGANVM_ Omniscience-Gauntlet_v2.html` prototype.
> - **Manifest Pipeline**: `scripts/generate-manifest.py` is confirmed as obsolete; its logic is now integrated into `src/lib/ingestion/ingest-worker.ts`.

## Proposed Changes

### 1. Infrastructure (Gaps 1, 4, 5)

#### [NEW] [validate-env.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/scripts/validate-env.ts)
- Create a script to validate required environment variables (`DATABASE_URL`, `EMBEDDING_API_KEY`, `ADMIN_SESSION_SECRET`, etc.).
- Integration into the build process or pre-commit hook.

#### [MODIFY] [.env.example](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/.env.example)
- Ensure all production-critical variables are documented.

#### [VERIFY] Build & Deployment
- Run `npm run build` locally to identify and fix any production build issues.
- Audit `vercel.json` for proper headers, redirects, and environment configurations.

#### [EXECUTE] Database Migrations
- Run `npx drizzle-kit generate` and `npx drizzle-kit migrate` to ensure the schema is up-to-date.
- Verify `seed.yaml` and seed the database if necessary.

---

### 2. Backend & Pipeline (Gaps 3, 6)

#### [MODIFY] [ingest-worker.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/src/lib/ingestion/ingest-worker.ts)
- Finalize the refactor, ensuring robust error handling and proper manifest generation.
- Ensure the `MANIFEST_OUTPUT` is correctly placed and used by the retrieval system.

#### [COMMIT] Ingestion Engine
- Add and commit everything in `src/lib/ingestion/`.

---

### 3. Frontend Integration (Gaps 2, 7)

#### [MODIFY] [page.tsx](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/src/app/ask/page.tsx)
- Integrate the structure from `ORGANVM_ Omniscience-Gauntlet_v2.html`.

#### [MODIFY] [ChatInterface.tsx](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/src/components/ChatInterface.tsx)
- Apply premium glassmorphic styles.
- Refactor to match the modern UI hierarchy (centered column, improved bubble designs, source panels).
- Add "Last Synced" state indicator (likely in the footer or nav via a global state/API call).

#### [MODIFY] [globals.css](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/src/app/globals.css)
- Incorporate the detailed CSS tokens and styles from the `v2.html` prototype.

---

### 4. Final Cleanup

- Remove redundant static HTML files (`v0.html`, `v1.html`) if no longer needed.
- Stage and commit all remaining untracked/modified files with clear, imperative commit messages.

## Verification Plan

### Automated Tests
- Run `npm test` (vitest) to ensure no regressions in hybrid retrieval or queue logic.
- Run `npm run build` locally to verify production readiness.

### Manual Verification

- **Ingestion**: Run the ingestion worker and verify the generated `manifest.json`.
- **Ask Page**: Navigate to `/ask` and perform a test query to verify:
  - UI aesthetics match the prototype.
  - Streaming responses and citations work correctly.
- **Environment**: Run `npx tsx scripts/validate-env.ts` to ensure all secrets are present.
