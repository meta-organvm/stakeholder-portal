# Hermeneus: Transcript-Driven Contextual Awareness Plan

**Date**: 2026-03-05  
**Source**: HTML transcript of conversation at `/ask` (stakeholder-portal-ten.vercel.app)  
**Objective**: Bridge the gap between the ideal intelligence layer and current implementation.

**Version**: 2 (post Evaluation-to-Growth review)

### Why this matters

The portal is meant to be the intelligence layer for ORGANVM — queryable by non-technical stakeholders via natural language. Today it answers from manifest summaries alone; deep questions (file location, research linkage, corpus analytics, personal knowledge) fail. Implementing this plan turns it into the "ever recallable, quickly sorting and searching" knowledge-keeper the transcript envisions: stakeholders get file-level answers, research linkage, and analytics; personal knowledge from my-knowledge-base surfaces when federated.

**Stakeholder personas**:
- **Public stakeholders** (investors, partners): Manifest + Phase 2 corpus. No personal knowledge-base.
- **Internal / single-user**: Manifest + my-knowledge-base + Phase 2–4. Full "brain in your work" access.

---

## 0. Assumptions & Prerequisites

| Assumption | Notes |
|------------|-------|
| my-knowledge-base API is available and stable | REST API documented; schema/response format used as-is |
| Portal can reach my-knowledge-base at runtime | Configurable URL; localhost for dev, internal URL for production |
| Workspace layout matches organ directories | `organvm-i-theoria`, `organvm-iv-taxis`, etc. per `ORGAN_DIR_MAP` |
| Repo count: manifest = source of truth | Manifest reports ~103 repos; workspace may have 111 (uncloned/submodules) |
| High-leverage Steps 1–2 (locking, auth) precede Phase 2 | Phase 2 depends on DB; locking schema must exist |

**Out of scope (this plan)**: Replication of my-knowledge-base atomization logic; ingestion of raw source code beyond markdown/docs; real-time web crawling.

---

## 1. Ideal Vision (from transcript)

The user’s questions and the AI’s self-descriptions imply these goals:

| Capability | Ideal | Example question |
|------------|-------|------------------|
| **Full codebase access** | Access to all code, docs, research, markdown across all repos<sup>1</sup> | "do you have full access to all code & docs/research/markdowns in my entire codebase?" |
| **Granular file-level query** | Any bit of data/info queryable from macro to micro | "where is the merlin/sage/old-man archetype filed in tool-interaction-design/conductor" |
| **External research linkage** | Link decisions and research to external references | "was stickk.com researched when building peer-reviewed behavior blockchain?" |
| **Full-text corpus analysis** | Aggregated analytics across the system | "what are the most used words & phrases throughout the entire organvm system" |
| **Knowledge-keeper persona** | User's "brain in their work" — recallable, sortable, searchable | "best knowledge-keeper… ever recallable quickly sorting and searching memory" |

<sup>1</sup> Manifest snapshot: ~103 repos. Workspace total may differ (111+ with submodules/uncloned).

---

## 2. Current State

### 2.1 Data available to the AI

| Source | Content | Limits |
|--------|---------|--------|
| `manifest.json` | 103 repos with metadata, description, tech stack, deployments | Static snapshot, refreshed on build |
| `ai_context` per repo | ~500-word summary: description + first para of key sections + tech + deploys | No full text of docs |
| `sections` per repo | Selected sections (what this is, architecture, features, build & dev, conventions, etc.) | Truncated to 1500 chars each |
| CLAUDE.md / README.md | Parsed by `generate-manifest.py` | Only what fits in `sections` / `ai_context` |
| Knowledge graph | Entities from manifest, graph traversal | No file-level or code-level entities |

### 2.2 Retrieval pipeline

- **Hybrid retrieval** (lexical + TF-IDF + graph) over manifest repos only
- **Top 15** sources, each with a ~300-char snippet
- **Context budget**: Tier 1 (~2K tokens) + evidence (~5–15K tokens)
- **No access to**: raw source files, full markdown, commit messages, external URLs, intake/research docs

### 2.3 What the AI explicitly cannot do (from its own answers)

1. Browse or search the codebase
2. Access files not included in the provided context
3. Run or execute code
4. Access external information (e.g. stickk.com)
5. Answer file-level questions (e.g. merlin archetype in `conductor/`)

---

## 3. Gap Summary

| Dimension | Current | Ideal | Priority |
|-----------|---------|-------|----------|
| **Scope** | Manifest summaries + snippets | Full repo content (code + docs + research) | P0 |
| **Granularity** | Repo-level retrieval | File-level and paragraph-level | P0 |
| **Indexing** | Static manifest at build time | Persistent, searchable corpus | P0 |
| **External refs** | None | Research linkage, URL ingestion | P1 |
| **Analytics** | Aggregates from manifest | Full-text word frequency, phrase extraction | P1 |

---

## 4. Federated Source: my-knowledge-base

**Location**: `organvm-i-theoria/my-knowledge-base` (ORGAN-I / Theory)

The user's personal knowledge base already implements the granularization the portal needs:

| Capability | my-knowledge-base | Portal today |
|------------|-------------------|--------------|
| **Atomization** | AtomicUnit (insight, code, question, reference, decision) | Repo-level summaries only |
| **Full-text** | SQLite FTS5 | Manifest keyword scoring |
| **Semantic search** | ChromaDB + embeddings | None |
| **Hybrid retrieval** | FTS + semantic via RRF | Lexical + TF-IDF |
| **Knowledge graph** | unit_relationships, graph API | Manifest-based entity graph |
| **Document ingestion** | CLAUDE/Gemini/ChatGPT, local markdown, Google Docs, Apple Notes, Bookmarks | Manifest snapshot only |
| **Intelligence** | Insight extraction, smart tagging, relationship detection | None |

**Content overlap**: my-knowledge-base ingests the user's AI conversations, research notes, and bookmarks — the "brain in your work" the transcript asks for. ORGANVM-related decisions, research (e.g. stickk.com), and references live there.

**Implementation options**:
1. **Federated connector** — Call `my-knowledge-base` REST API (`/api/search/hybrid`, `/api/search/semantic`) when answering queries; merge results into retrieval context.
2. **Orchestrated ingestion** — Cron/sync to pull ORGANVM-tagged units from my-knowledge-base into the portal's vector store (when Phase 2 exists).
3. **Shared vocabulary** — Align entity/unit types so portal can interpret my-knowledge-base results and cite them correctly.

---

## 5. Phase Dependencies & Source Hierarchy

### Phase dependencies

| Phase | Depends on | Blocks |
|-------|------------|--------|
| **1** | Nothing | — |
| **1b** | Nothing (requires my-knowledge-base running) | — |
| **2** | High-leverage Step 6 (DB schema); can follow Phase 1 | Phase 3 |
| **3** | Phase 2 corpus | — |
| **4** | None | — (optional, parallel to Phase 3) |

**Rationale for order**: Phase 1 and 1b deliver quick wins with no infra change. Phase 2 requires Postgres + pgvector (high-leverage Step 6). Phase 3 needs the Phase 2 corpus. Phase 4 is independent and can run in parallel.

### Source hierarchy (canonical → supplemental)

1. **Manifest** — Canonical. Registry-derived, build-time snapshot. Always included.
2. **my-knowledge-base** — Supplemental. Personal conversations, research, bookmarks. Opt-in, federated.
3. **Ingested corpus** (Phase 2+) — Supplemental. File-level content from workspace. Augments manifest.
4. **External research** (Phase 4) — Supplemental. URL metadata from intake/research. Optional.

---

## 6. Implementation Plan

### Phase 1: Deepening manifest content (quick wins)

**Goal**: Increase information density without changing architecture.

1. **Expand section coverage**
   - Add more section keys in `generate-manifest.py` (e.g. `key files`, `data integrity rules`, `schemas`)
   - Raise per-section limit from 1500 to 2500 chars for retrieval-relevant sections

2. **Add file inventory per repo**
   - For each repo, emit a `file_index: string[]` of key paths (e.g. `conductor/archetypes/*`, `scripts/*.py`) so the AI can say "check X" even without full content

3. **Include directory tree for conductor-style queries**
   - For known high-value paths (e.g. `tool-interaction-design/conductor`), include lightweight directory structure in manifest or a `path_hints` field

**Effort**: 1–2 days | **Risk**: Low

**Acceptance criteria**:
- [ ] Manifest schema includes `file_index` (or equivalent) for at least high-value repos
- [ ] Section keys include `key files`, `data integrity rules` where present in CLAUDE.md
- [ ] Regenerate manifest; verify retrieval surfaces more conductor-style paths

---

### Phase 1b: my-knowledge-base federation (parallel to Phase 1)

**Goal**: Surface the user's atomized knowledge (conversations, research, decisions) in the portal.

1. **Connector module**
   - Add `src/lib/knowledge-base-connector.ts` (or similar)
   - When `MY_KNOWLEDGE_BASE_API_URL` is set, call `/api/search/hybrid?q=...` with the user query
   - Map returned `AtomicUnit[]` into `RetrievalSource[]` with `source_type: "knowledge_base"`

2. **Query planner**
   - For exploratory or research-oriented queries, include knowledge-base retrieval
   - Merge knowledge-base results with manifest retrieval using RRF or score normalization

3. **Citation**
   - Cite knowledge-base units with `source_name: "Personal Knowledge Base"`, link to unit ID if my-knowledge-base UI is reachable

4. **Environment**
   - `MY_KNOWLEDGE_BASE_API_URL` (e.g. `http://localhost:3000/api` when my-knowledge-base `npm run web` runs)
   - Optional: `MY_KNOWLEDGE_BASE_ENABLED=true` to gate the feature

**Operational notes**:
- **Prerequisite**: my-knowledge-base web server must be running (`npm run web` or equivalent).
- **Merge strategy**: Append top N knowledge-base results (e.g. 5) to manifest results; cap total context tokens (e.g. 12K evidence tokens) to avoid overflow.
- **Fallback**: If connector fails (timeout, 5xx, network error), proceed with manifest-only retrieval; log diagnostic; do not fail the request.
- **Security/Privacy**: Knowledge-base may contain personal data. Gate behind `MY_KNOWLEDGE_BASE_ENABLED`; document that enabling exposes personal content to portal answers; consider access control for production.

**Effort**: 2–4 days (assumes familiarity with hybrid-retrieval + my-knowledge-base API) | **Risk**: Low functional risk; operational risk if my-knowledge-base is unreachable (mitigated by fallback)

**Acceptance criteria**:
- [ ] With connector enabled and my-knowledge-base reachable, exploratory queries return knowledge-base units in citations
- [ ] With connector disabled or unreachable, portal behaves as today (manifest-only)
- [ ] Citations include `source_type: "knowledge_base"` and unit reference

---

### Phase 2: File-level ingestion + vector store

**Goal**: Make arbitrary file content from workspace repos queryable via semantic search.

**Scope**: my-knowledge-base remains a *federated* source (Phase 1b). Phase 2 ingests *system-wide* repo files (CLAUDE.md, docs, conductor, etc.) into the portal's own vector store. No ingestion of my-knowledge-base content here — that stays federated.

1. **Ingest pipeline**
   - Extend `generate-manifest.py` or add `scripts/ingest-corpus.py` that:
     - Walks workspace per organ/repo (respecting `ORGAN_DIR_MAP`)
     - Ingests `CLAUDE.md`, `README.md`, `AGENTS.md`, `*.md` under `docs/`, `conductor/*`, key `scripts/*.py`, etc.
     - Chunks at paragraph/section level (semantic boundaries)
   - Use incremental/cursor-based ingest where possible; define max corpus size to bound runtime.

2. **Vector store**
   - Use **pgvector** (align with high-leverage Step 6) to store embeddings
   - Schema: chunks with (content, repo, path, organ, embedding)

3. **Retrieval integration**
   - Add semantic retrieval in `hybrid-retrieval.ts` over the vector store
   - For path-specific queries (e.g. "merlin archetype in conductor"), detect path hints and filter/boost by path

**Effort**: 1–2 weeks | **Risk**: Medium (DB + embeddings setup)

**Acceptance criteria**:
- [ ] Ingest completes for all manifest repos with local paths
- [ ] Semantic search returns chunks for file-level queries
- [ ] "Where is merlin archetype in conductor?" returns file/path (when present in ingested content)

---

### Phase 3: Full-text corpus + analytics

**Goal**: Answer "most used words", phrase extraction, cross-repo patterns.

**Corpus scope**: Phase 2 ingested files + manifest metadata. Excludes my-knowledge-base unless explicitly ingested in a future phase.

1. **Corpus index**
   - Store tokenized text per file/repo with metadata (organ, repo, path)
   - Support full-text search (PostgreSQL `tsvector` / `tsquery`)

2. **Analytics endpoints**
   - Add `/api/analytics/word-frequency` (and similar) that:
     - Runs server-side over the indexed corpus
     - Returns top N words/phrases with counts and optional repo breakdown

3. **Query planner**
   - Detect analytics-style intents (e.g. "most used words", "common phrases") and route to analytics path instead of LLM retrieval

**Effort**: 1–2 weeks | **Risk**: Medium

**Acceptance criteria**:
- [ ] "Most used words across ORGANVM" returns corpus-derived results (not LLM inference)
- [ ] Analytics endpoint supports repo-level breakdown

---

### Phase 4: External research linkage (optional)

**Goal**: Link internal decisions to external references.

1. **Research doc ingestion**
   - Define a location for research notes (e.g. `intake/`, `research/`) and ingest markdown/links
   - Extract URLs and key claims into structured records

2. **URL metadata**
   - For referenced URLs (e.g. stickk.com), store title, snippet, and link to the repo/section that references it
   - Allow queries like "was X researched for Y" when the reference exists in ingested docs

**Effort**: 1–2 weeks | **Risk**: Medium (privacy, scope creep)

**Acceptance criteria**:
- [ ] Ingested research docs with URLs are queryable
- [ ] "Was stickk.com researched for behavior blockchain?" returns evidence when present in ingested docs

---

## 7. Alignment with existing plans

| Plan | Overlap | Notes |
|------|---------|-------|
| `2026-03-05-high-leverage-sequence.md` | Step 6 (Durable Core Intelligence State) | Phase 2 here uses the same DB + vector/graph direction |
| `2026-03-05-omnipresence-contextual-awareness-plan-v6.md` | Admin hardening | This plan focuses on *content* and *retrieval*, not auth/scheduler |
| Hermeneus CLAUDE.md | Architecture | Phase 1–3 preserve the existing three-layer design; Phase 2 extends the data pipeline |
| `organvm-i-theoria/my-knowledge-base` | Federated source | Phase 1b adds connector; existing API (38 endpoints) used as-is |

---

## 8. Risk Analysis Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| my-knowledge-base unreachable | High | Phase 1b fallback: manifest-only; timeout + circuit breaker |
| Portal on Vercel, knowledge-base on localhost | High | Document: production requires internal URL or tunnel for my-knowledge-base |
| Phase 2 ingest scales poorly (111 repos) | Medium | Incremental ingest; max corpus size; prioritize high-value paths |
| Phase 1b exposes personal content publicly | Medium | Opt-in (`MY_KNOWLEDGE_BASE_ENABLED`); access control; document privacy implications |
| High-leverage Steps 1–5 not done before Phase 2 | Medium | Phase 2 explicitly depends on Step 6 (DB); sequence in plan |

**Contingencies**:
- If my-knowledge-base unavailable: retrieval behaves as today (manifest-only).
- If Phase 2 too heavy: restrict to high-value repos/paths first (e.g. conductor, meta-organvm).

---

## 9. Success criteria (system-wide)

- [ ] AI can answer "where is the merlin archetype in tool-interaction-design?" with file/path (Phase 2)
- [ ] AI can answer "do you have full access to the codebase?" with an honest, nuanced answer (Phase 2)
- [ ] Analytics-style queries ("most used words") return real corpus-derived results (Phase 3)
- [ ] External references are linkable when present in ingested research docs (Phase 4)
- [ ] my-knowledge-base federation: queries surface relevant atomic units (Phase 1b)

---

## 10. Next step

**Immediate**: Implement Phase 1.1–1.2 (expand sections + add file inventory) in `generate-manifest.py` and verify improved answers for conductor-style and metadata-heavy queries.

---

## Appendix: Evaluation-to-Growth v2 Changelog

| Change | Section |
|--------|---------|
| Assumptions & Prerequisites | §0 |
| Repo count footnote (103 vs 111) | §1 |
| Phase Dependencies & Source Hierarchy | §5 |
| Acceptance criteria per phase | §6 |
| Phase 1b: operational notes, merge strategy, fallback, security | §6 |
| Phase 2: scope clarification (my-kb stays federated); pgvector explicit | §6 |
| Phase 3: corpus scope (Phase 2 files + manifest) | §6 |
| Risk Analysis Summary | §8 |
| Success criteria linked to phases | §9 |
| Why this matters + stakeholder personas | Intro |
