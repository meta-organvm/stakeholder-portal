# S28 Hermeneus — Propagation Handoff

**Session:** S28 (Hermeneus remediation + features)
**Date:** 2026-03-21
**Status:** ALL EXECUTED — 0 remaining. Companion indices deferred (blocked on IRF-IDX-001/002/003).

---

## 1. IRF-HRM-005 — Testament Cascade

**Why:** S28 produced major system events (Next.js 16, SSE streaming, provider cascade, rename) that belong in the generative self-portrait chain.

**Prerequisites:** meta-organvm venv activated

**Commands:**
```bash
cd ~/Workspace/meta-organvm
source .venv/bin/activate
organvm testament cascade --write
```

**Expected:** 8 nodes produce ~19 shapes (density, dependency, omega, status, prose, social, sonic, topology). The cascade auto-discovers from git history — S28 commits in stakeholder-portal will be picked up.

**Verify:** `organvm testament status` should show latest artifact date as 2026-03-21 (currently 2026-03-20).

---

## 2. IRF-HRM-002 — Registry Entry Update

**Why:** The registry-v2.json entry for stakeholder-portal still says "Next.js stakeholder intelligence portal" with no display_name, no CI workflow reference, and `public: false`. Needs to reflect Hermeneus identity and current capabilities.

**Current entry (in `organvm-corpvs-testamentvm/registry-v2.json`):**
```json
{
  "name": "stakeholder-portal",
  "description": "Next.js stakeholder intelligence portal...",
  "public": false,
  "ci_workflow": null
}
```

**Required changes:**
```
display_name:       → "Hermeneus"
description:        → "Hermeneus (ἑρμηνεύς) — ORGANVM intelligence layer. AI chat with hybrid retrieval, provider cascade, SSE streaming, operational control plane."
public:             false → true (it's deployed on Vercel publicly)
ci_workflow:        null → ".github/workflows/ci.yml"
last_validated:     "2026-03-10" → "2026-03-21"
note:               append " Rebranded to Hermeneus 2026-03-21."
```

**Command:**
```bash
cd ~/Workspace/meta-organvm
source .venv/bin/activate
organvm registry update stakeholder-portal display_name "Hermeneus"
organvm registry update stakeholder-portal description "Hermeneus — ORGANVM intelligence layer. AI chat with hybrid retrieval, provider cascade, SSE streaming, operational control plane."
organvm registry update stakeholder-portal public true
organvm registry update stakeholder-portal ci_workflow ".github/workflows/ci.yml"
organvm registry validate
```

**Verify:** `organvm registry show stakeholder-portal` shows updated fields.

---

## 3. IRF-HRM-003 — Concordance Registration

**Why:** S28 introduced new API routes and the IRF-HRM namespace. The concordance (444 entries across 8 namespaces) tracks all governance IDs. The `irf` namespace already has 320 entries — IRF-HRM-001 through IRF-HRM-008 need adding.

**File:** `organvm-corpvs-testamentvm/docs/operations/concordance.md`

**Entries to add to the `irf` namespace section:**

```markdown
| IRF-HRM-001 | Repo rename coordination (stakeholder-portal → hermeneus) | P1 | IRF, GH#28 |
| IRF-HRM-002 | Registry entry update (display_name, description, capabilities) | P1 | IRF |
| IRF-HRM-003 | Concordance registration of new API routes | P1 | IRF |
| IRF-HRM-004 | Custom domain (hermeneus.organvm.io) | P2 | IRF |
| IRF-HRM-005 | Testament cascade for S28 events | P1 | IRF |
| IRF-HRM-006 | Omega #9 stranger-test Hermeneus | P2 | IRF, Omega |
| IRF-HRM-007 | Streaming markdown rendering fix | P2 | IRF |
| IRF-HRM-008 | Full re-ingestion with retry logic | P2 | IRF |
```

**Command:** Manual edit to concordance.md, then `python3 scripts/invoke.py --list` to verify count increased.

**Verify:** `python3 scripts/invoke.py IRF-HRM-001` resolves correctly.

---

## 4. Inquiry Log — INQ-2026-002 Evidence Note

**Why:** D-002 ("Recursive Institutional Governance Through Multi-Model Evaluative Consensus") needs "Second instantiation (deploy against ORGAN-IV Taxis)" — the Hermeneus provider cascade is exactly this. It deploys multi-model governance (Groq primary → OSS fallback with error isolation, ad-injection stripping as quality governance, /api/health/llm as institutional health monitoring) against a live production system. This is instantiation evidence, not a stretch.

**File:** `praxis-perpetua/commissions/inquiry-log.yaml`

**Add to INQ-2026-002's `evidence` field (create if absent):**

```yaml
    evidence:
      - date: 2026-03-21
        session: S28
        type: instantiation
        description: >-
          Hermeneus provider cascade deployed as second instantiation site.
          Multi-model governance: Groq primary → OSS fallback with per-provider
          error isolation. Quality governance: ad-injection stripping on model
          output. Institutional health: /api/health/llm probes all providers,
          reports latency and status. Self-aware evidence quality: stale-context
          warnings when retrieval sources are aged.
        artifacts:
          - src/app/api/chat/route.ts (provider cascade, ad stripping)
          - src/app/api/health/llm/route.ts (institutional health monitoring)
          - seed.yaml (6 declared capabilities)
```

**Verify:** The `needs` list item "Second instantiation (deploy against ORGAN-IV Taxis)" can be amended to note partial completion — Hermeneus is META not ORGAN-IV, but the pattern is proven.

---

## 5. Companion Indices — Deferred (blocked on IRF-IDX-001/002/003)

**Why these cannot be done now:** The three companion indices (Locorum, Nominum, Rerum) don't exist yet. They're P1 items in the IRF (IRF-IDX-001, IRF-IDX-002, IRF-IDX-003). When they're built, the following S28 artifacts need inclusion:

**For Index Locorum (places):**
- `/api/health/llm` — LLM provider health endpoint (Hermeneus, Vercel)
- `/api/cron/ingest` — Ingestion health endpoint (Hermeneus, Vercel)
- `stakeholder-portal-ten.vercel.app` — Production deployment URL

**For Index Nominum (names):**
- `Hermeneus` — display name for stakeholder-portal repo
- `IRF-HRM-*` — new IRF namespace (8 items)
- `provider cascade` — architectural pattern name

**For Index Rerum (things):**
- `provider-cascade` capability (type: architectural-pattern, state: implemented)
- `sse-streaming` capability (type: feature, state: implemented)
- `stale-context-detection` capability (type: feature, state: implemented)

**Action:** When building any of IRF-IDX-001/002/003, grep this handoff for seed data.
