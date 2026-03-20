# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Hermeneus** — ORGANVM Stakeholder Intelligence Portal. A Next.js 15 intelligence layer with full contextual awareness of every repo across the eight-organ system. Features natural language chat (OSS/free LLM), hybrid vector+lexical retrieval, a Postgres-backed operational control plane, and admin dashboard with GitHub SSO.

## Build & Dev Commands

```bash
npm run dev              # next dev (localhost:3000)
npm run lint             # eslint (flat config), --max-warnings=0
npm run test             # vitest run (all tests in tests/)
npm run test -- tests/query-planner.test.ts   # single test file
npm run test:watch       # vitest watch mode
npm run build            # prebuild (generate + validate manifest) then next build

# Data pipeline — regenerate manifest from live workspace
npm run generate         # tsx ingest-worker.ts (requires DATABASE_URL + EMBEDDING_API_KEY)
npm run generate -- --allow-stale-manifest --skip-vector  # offline/CI mode

# Database (Drizzle + Postgres with pgvector)
npm run db:generate      # drizzle-kit generate (after schema changes)
npm run db:migrate       # drizzle-kit migrate
npm run db:studio        # drizzle-kit studio (GUI)

# Operational scripts
npm run maintenance:run  # run maintenance cycle (connectors + eval + alerts)
npm run eval:offline     # run eval suite offline
npm run ci:quality-gate  # CI threshold checks (citation coverage, hallucination, etc.)
npm run validate-manifest
```

## Architecture

```
[111 repos] → ingest-worker.ts → manifest.json + pgvector embeddings
                                         ↓
                              Next.js 15 app (Vercel)
                             /          |          \
                    static pages    /api/chat    /api/admin + /api/cron
                   (repo browser,  (hybrid       (maintenance, alerts,
                    organs, dash)   retrieval     connectors, auth)
                                   + LLM)
```

### Five layers

1. **Ingestion** (`src/lib/ingestion/ingest-worker.ts`) — Reads registry-v2.json, seed.yaml, CLAUDE.md/README.md, git logs → produces `src/data/manifest.json` AND chunks + embeds content into Postgres/pgvector via LangChain text splitters
2. **Frontend** (Next.js 15 + Tailwind 4 + React 19) — Static pages for repos, organs, dashboard, about
3. **AI chat** (`/api/chat`) — Query planner → hybrid retrieval (lexical + vector + knowledge graph + federated) → Groq/OSS LLM streaming with citations and PII masking
4. **Control plane** — Maintenance cycles, connector orchestration, alert evaluation/dispatch, job queue (Postgres SKIP LOCKED), escalation policies
5. **Database** (Drizzle ORM + Postgres + pgvector) — Document chunks with HNSW vector index, job queue, maintenance ledger, alert audit trail, connector cursors, escalation policies

### Chat pipeline detail

```
User query → planQuery() → hybridRetrieve() → buildCitations() → LLM stream
               ↓                ↓
         QueryStrategy     Multi-signal scoring:
         classification     - lexical (TF-IDF)
         + sub-queries      - vector (pgvector cosine)
         + answerability    - knowledge graph traversal
                            - federated knowledge base
```

`QueryStrategy` types: `deterministic`, `single_repo`, `organ_scope`, `cross_organ`, `system_wide`, `graph_traversal`, `live_research`, `analytics`, `exploratory`.

### Key files

| Path | Purpose |
|------|---------|
| `src/lib/ingestion/ingest-worker.ts` | Manifest generation + vector embedding pipeline |
| `src/data/manifest.json` | Generated data snapshot (committed, refreshed intentionally) |
| `src/lib/types.ts` | TypeScript interfaces for manifest schema |
| `src/lib/manifest.ts` | Manifest loader + query helpers |
| `src/lib/query-planner.ts` | Cost-based strategy selection + query decomposition |
| `src/lib/hybrid-retrieval.ts` | Multi-signal retrieval (lexical + vector + graph + federated) |
| `src/lib/retrieval.ts` | Tier-1/Tier-2 context assembly (original lexical retrieval) |
| `src/lib/citations.ts` | Citation extraction and inline formatting |
| `src/lib/graph.ts` | Knowledge graph (produces/consumes edges from seeds) |
| `src/lib/entity-registry.ts` | Named entity index for disambiguation |
| `src/app/api/chat/route.ts` | Chat endpoint: rate limiting, security, LLM streaming |
| `src/lib/db/schema.ts` | Drizzle schema (all tables + vector index) |
| `src/lib/maintenance.ts` | Maintenance cycle orchestration + scorecard |
| `src/lib/alerts.ts` | System alert evaluation from scorecard data |
| `src/lib/alert-sinks.ts` | Alert dispatch (Slack, webhook, email) with retry |
| `src/lib/connectors/` | Pluggable data connectors (docs, workspace, GitHub, Slack) |
| `src/lib/platform-config.ts` | Runtime config registry (connectors, retention, compliance, SLOs) |
| `src/lib/security.ts` | PII masking, access context, audit logging |
| `src/lib/observability.ts` | Counters, timing, metrics snapshot |
| `src/auth.ts` | NextAuth config (GitHub OAuth provider) |
| `src/middleware.ts` | Edge middleware — session enforcement for /admin, /dashboard |
| `drizzle.config.ts` | Drizzle Kit config (migrations at `src/lib/db/migrations/`) |

### Pages

- `/` — Landing: metrics, organ cards, deployments
- `/repos` — Filterable repo browser
- `/repos/[slug]` — Repo detail with sections, git stats, links
- `/organs` — Organ grid overview
- `/organs/[key]` — Organ detail with repos
- `/dashboard` — Metrics, promotion pipeline, CI health (requires auth)
- `/ask` — AI chat interface
- `/about` — Methodology and organ descriptions
- `/admin/login` — Admin login
- `/admin/intel` — Admin intelligence panel

### API routes

- `POST /api/chat` — Streaming chat with rate limiting (10 req/min per IP)
- `POST /api/feedback` — User feedback on chat responses
- `GET /api/analytics/word-frequency` — Corpus text analytics
- `POST /api/cron/maintenance` — Cron-triggered maintenance cycle (auth: `CRON_SECRET`)
- `GET|POST /api/admin/intel` — Admin scorecard/alerts (auth: session or `ADMIN_API_TOKEN`)
- `POST /api/admin/session` — Admin session management
- `GET|POST /api/auth/[...nextauth]` — NextAuth handlers

## Database

Postgres with pgvector extension. Schema in `src/lib/db/schema.ts`:

- `document_chunks` — Chunked content with 384-dim embeddings (HNSW index, HuggingFace all-MiniLM-L6-v2) + tsvector full-text search (GIN index)
- `jobs` — Postgres-based job queue with SKIP LOCKED dequeue
- `maintenance_runs` — Maintenance cycle ledger with scorecards
- `singleton_locks` — Distributed locking for maintenance/cron
- `alert_deliveries` — Alert dispatch audit trail
- `escalation_policies` — Configurable alert escalation rules
- `connector_cursors` — Incremental sync state per connector

Connection: `DATABASE_URL` env var. Default: `postgresql://postgres:postgres@localhost:5432/stakeholder_portal`

## Environment

Copy `.env.example` → `.env`. Key variable groups:

- **LLM**: `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_API_URL` (primary); `OSS_LLM_API_URL`, `OSS_LLM_MODEL` (fallback)
- **Database**: `DATABASE_URL` (required for ingestion, maintenance, vector search)
- **Embeddings**: `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_API_URL`
- **Auth**: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (NextAuth GitHub SSO)
- **Admin**: `ADMIN_API_TOKEN`, `ADMIN_LOGIN_PASSWORD`, `ADMIN_SESSION_SECRET`
- **Alerts**: `SLACK_WEBHOOK_URL`, `ALERT_WEBHOOK_URL`, `RESEND_API_KEY`, `ALERT_EMAIL_TO`
- **Cron**: `CRON_SECRET`, `CRON_CONNECTOR_IDS`
- **Federation**: `MY_KNOWLEDGE_BASE_API_URL`, `MY_KNOWLEDGE_BASE_ENABLED`
- **CI thresholds**: `ALERT_MIN_CITATION_COVERAGE`, `ALERT_MAX_HALLUCINATION_RATE`, etc.

## Conventions

- Node 20+, npm
- TypeScript strict mode
- Tailwind v4 (PostCSS plugin)
- Dark theme with CSS custom properties
- Conventional commits
- Tests in `tests/` (not co-located), using Vitest
- `@/` path alias maps to `src/`

<!-- ORGANVM:AUTO:START -->
## System Context (auto-generated — do not edit)

**Organ:** META-ORGANVM (Meta) | **Tier:** standard | **Status:** PUBLIC_PROCESS
**Org:** `meta-organvm` | **Repo:** `stakeholder-portal`

### Edges
- **Produces** → `external-stakeholders`: stakeholder-intelligence-ui
- **Consumes** ← `organvm-corpvs-testamentvm`: registry-v2.json
- **Consumes** ← `organvm-corpvs-testamentvm`: system-metrics.json
- **Consumes** ← `organvm-engine`: organvm-engine

### Siblings in Meta
`.github`, `organvm-corpvs-testamentvm`, `alchemia-ingestvm`, `schema-definitions`, `organvm-engine`, `system-dashboard`, `organvm-mcp-server`, `praxis-perpetua`, `materia-collider`, `organvm-ontologia`, `vigiles-aeternae--agon-cosmogonicum`

### Governance
- *Standard ORGANVM governance applies*

*Last synced: 2026-03-20T10:58:36Z*

## Session Review Protocol

At the end of each session that produces or modifies files:
1. Run `organvm session review --latest` to get a session summary
2. Check for unimplemented plans: `organvm session plans --project .`
3. Export significant sessions: `organvm session export <id> --slug <slug>`
4. Run `organvm prompts distill --dry-run` to detect uncovered operational patterns

Transcripts are on-demand (never committed):
- `organvm session transcript <id>` — conversation summary
- `organvm session transcript <id> --unabridged` — full audit trail
- `organvm session prompts <id>` — human prompts only


## Active Directives

| Scope | Phase | Name | Description |
|-------|-------|------|-------------|
| organ | any | commit-and-release-workflow | Commit & Release Workflow |
| organ | any | session-state-management | session-state-management |
| organ | any | submodule-sync-protocol | submodule-sync-protocol |
| system | any | prompting-standards | Prompting Standards |
| system | any | research-standards-bibliography | APPENDIX: Research Standards Bibliography |
| system | any | phase-closing-and-forward-plan | METADOC: Phase-Closing Commemoration & Forward Attack Plan |
| system | any | research-standards | METADOC: Architectural Typology & Research Standards |
| system | any | sop-ecosystem | METADOC: SOP Ecosystem — Taxonomy, Inventory & Coverage |
| system | any | autonomous-content-syndication | SOP: Autonomous Content Syndication (The Broadcast Protocol) |
| system | any | autopoietic-systems-diagnostics | SOP: Autopoietic Systems Diagnostics (The Mirror of Eternity) |
| system | any | background-task-resilience | background-task-resilience |
| system | any | cicd-resilience-and-recovery | SOP: CI/CD Pipeline Resilience & Recovery |
| system | any | community-event-facilitation | SOP: Community Event Facilitation (The Dialectic Crucible) |
| system | any | context-window-conservation | context-window-conservation |
| system | any | conversation-to-content-pipeline | SOP — Conversation-to-Content Pipeline |
| system | any | cross-agent-handoff | SOP: Cross-Agent Session Handoff |
| system | any | cross-channel-publishing-metrics | SOP: Cross-Channel Publishing Metrics (The Echo Protocol) |
| system | any | data-migration-and-backup | SOP: Data Migration and Backup Protocol (The Memory Vault) |
| system | any | document-audit-feature-extraction | SOP: Document Audit & Feature Extraction |
| system | any | dynamic-lens-assembly | SOP: Dynamic Lens Assembly |
| system | any | essay-publishing-and-distribution | SOP: Essay Publishing & Distribution |
| system | any | formal-methods-applied-protocols | SOP: Formal Methods Applied Protocols |
| system | any | formal-methods-master-taxonomy | SOP: Formal Methods Master Taxonomy (The Blueprint of Proof) |
| system | any | formal-methods-tla-pluscal | SOP: Formal Methods — TLA+ and PlusCal Verification (The Blueprint Verifier) |
| system | any | generative-art-deployment | SOP: Generative Art Deployment (The Gallery Protocol) |
| system | any | market-gap-analysis | SOP: Full-Breath Market-Gap Analysis & Defensive Parrying |
| system | any | mcp-server-fleet-management | SOP: MCP Server Fleet Management (The Server Protocol) |
| system | any | multi-agent-swarm-orchestration | SOP: Multi-Agent Swarm Orchestration (The Polymorphic Swarm) |
| system | any | network-testament-protocol | SOP: Network Testament Protocol (The Mirror Protocol) |
| system | any | open-source-licensing-and-ip | SOP: Open Source Licensing and IP (The Commons Protocol) |
| system | any | performance-interface-design | SOP: Performance Interface Design (The Stage Protocol) |
| system | any | pitch-deck-rollout | SOP: Pitch Deck Generation & Rollout |
| system | any | polymorphic-agent-testing | SOP: Polymorphic Agent Testing (The Adversarial Protocol) |
| system | any | promotion-and-state-transitions | SOP: Promotion & State Transitions |
| system | any | recursive-study-feedback | SOP: Recursive Study & Feedback Loop (The Ouroboros) |
| system | any | repo-onboarding-and-habitat-creation | SOP: Repo Onboarding & Habitat Creation |
| system | any | research-to-implementation-pipeline | SOP: Research-to-Implementation Pipeline (The Gold Path) |
| system | any | security-and-accessibility-audit | SOP: Security & Accessibility Audit |
| system | any | session-self-critique | session-self-critique |
| system | any | smart-contract-audit-and-legal-wrap | SOP: Smart Contract Audit and Legal Wrap (The Ledger Protocol) |
| system | any | source-evaluation-and-bibliography | SOP: Source Evaluation & Annotated Bibliography (The Refinery) |
| system | any | stranger-test-protocol | SOP: Stranger Test Protocol |
| system | any | strategic-foresight-and-futures | SOP: Strategic Foresight & Futures (The Telescope) |
| system | any | styx-pipeline-traversal | SOP: Styx Pipeline Traversal (The 7-Organ Transmutation) |
| system | any | system-dashboard-telemetry | SOP: System Dashboard Telemetry (The Panopticon Protocol) |
| system | any | the-descent-protocol | the-descent-protocol |
| system | any | the-membrane-protocol | the-membrane-protocol |
| system | any | theoretical-concept-versioning | SOP: Theoretical Concept Versioning (The Epistemic Protocol) |
| system | any | theory-to-concrete-gate | theory-to-concrete-gate |
| system | any | typological-hermeneutic-analysis | SOP: Typological & Hermeneutic Analysis (The Archaeology) |
| unknown | any | SOP-001-vector-pipeline-activation | SOP-001: Vector Pipeline Activation |
| unknown | any | cicd-resilience | SOP: CI/CD Pipeline Resilience & Recovery |
| unknown | any | document-audit-feature-extraction | SOP: Document Audit & Feature Extraction v2.0 |
| unknown | any | ira-grade-norming | SOP: Diagnostic Inter-Rater Agreement (IRA) Grade Norming |
| unknown | any | ira-grade-norming | ira-grade-norming |
| unknown | any | pitch-deck-rollout | SOP: Pitch Deck Generation & Rollout |

Linked skills: cicd-resilience-and-recovery, continuous-learning-agent, cross-agent-handoff, evaluation-to-growth, genesis-dna, multi-agent-workforce-planner, promotion-and-state-transitions, quality-gate-baseline-calibration, repo-onboarding-and-habitat-creation, session-self-critique, structural-integrity-audit


**Prompting (Anthropic)**: context 200K tokens, format: XML tags, thinking: extended thinking (budget_tokens)


## Ecosystem Status

- **delivery**: 0/1 live, 0 planned
- **content**: 0/1 live, 0 planned
- **community**: 0/1 live, 1 planned

Run: `organvm ecosystem show stakeholder-portal` | `organvm ecosystem validate --organ META`


## Task Queue (from pipeline)

**223** pending tasks | Last pipeline: unknown

- `d883e9316e44` 1. collective-persona-operations (ORGAN-I / Theory) [astro, mcp, python]
- `d4bde336e3cb` 2. my-knowledge-base (ORGAN-I / Theory) [astro, mcp, python]
- `e41c948d9df5` 3. linguistic-atomization-framework (ORGAN-I / Theory) [astro, mcp, python]
- `1d48051f36c0` 4. portfolio/consult (PERSONAL) [astro, mcp, python]
- `99ab62e3ffda` 5. agentic-titan (ORGAN-IV / Orchestration) [astro, mcp, python]
- `51b187cd26b6` Ingest SOPs (collective-persona-operations → portal vector store) — highest impact, straightforward [astro, mcp, python]
- `db51a6f18581` Deepen federated knowledge-base integration — already wired, just needs boosting for meta_vision [astro, mcp, python]
- `8cc8a7e8d5d8` Cross-link consult ↔ portal — shared manifest, reciprocal links [astro, mcp, python]
- ... and 215 more

Cross-organ links: 549 | Top tags: `python`, `bash`, `mcp`, `pytest`, `typescript`

Run: `organvm atoms pipeline --write && organvm atoms fanout --write`


## Entity Identity (Ontologia)

**UID:** `ent_repo_01KKKX3RVRHC2D5H0G0D8870AG` | **Matched by:** primary_name

Resolve: `organvm ontologia resolve stakeholder-portal` | History: `organvm ontologia history ent_repo_01KKKX3RVRHC2D5H0G0D8870AG`


## Live System Variables (Ontologia)

| Variable | Value | Scope | Updated |
|----------|-------|-------|---------|
| `active_repos` | 1 | global | 2026-03-20 |
| `archived_repos` | 0 | global | 2026-03-20 |
| `ci_workflows` | 1 | global | 2026-03-20 |
| `code_files` | 0 | global | 2026-03-20 |
| `dependency_edges` | 0 | global | 2026-03-20 |
| `operational_organs` | 1 | global | 2026-03-20 |
| `published_essays` | 0 | global | 2026-03-20 |
| `repos_with_tests` | 0 | global | 2026-03-20 |
| `sprints_completed` | 0 | global | 2026-03-20 |
| `test_files` | 0 | global | 2026-03-20 |
| `total_organs` | 1 | global | 2026-03-20 |
| `total_repos` | 1 | global | 2026-03-20 |
| `total_words_formatted` | 0 | global | 2026-03-20 |
| `total_words_numeric` | 0 | global | 2026-03-20 |
| `total_words_short` | 0K+ | global | 2026-03-20 |

Metrics: 9 registered | Observations: 7184 recorded
Resolve: `organvm ontologia status` | Refresh: `organvm refresh`


## System Density (auto-generated)

AMMOI: 54% | Edges: 28 | Tensions: 33 | Clusters: 5 | Adv: 3 | Events(24h): 12929
Structure: 8 organs / 117 repos / 1654 components (depth 17) | Inference: 98% | Organs: META-ORGANVM:66%, ORGAN-I:55%, ORGAN-II:47%, ORGAN-III:56% +4 more
Last pulse: 2026-03-20T10:58:23 | Δ24h: -3.7% | Δ7d: n/a

<!-- ORGANVM:AUTO:END -->
