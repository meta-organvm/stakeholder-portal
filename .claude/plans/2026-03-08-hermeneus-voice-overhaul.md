# Hermeneus Voice Overhaul — Systemic Plan

**Date**: 2026-03-08
**Organ**: META-ORGANVM / stakeholder-portal
**Scope**: Chat system prompt, query planner, retrieval pipeline, frontend onboarding

## Problem

Hermeneus responds like a pre-recorded hotline. Canned deterministic responses, no access to the creator's vision corpus, no sense of who it's speaking to. When a real user asked "what did he make and why does it matter," the system cited `Schema Definitions` and said things like "Revolutionize the way we approach complex problem-solving." Generic, underselling, soulless.

## Design Principles

1. **No canned responses.** Every answer is generated live from current system state + retrieved context + the interaction itself. No `buildDeterministicAnswer` bypass.
2. **Vision as retrievable evidence.** VISION.md, the manifesto, and the full research corpus (~1.2MB, 36 files) in `praxis-perpetua/research/` are ingested into pgvector so retrieval can surface them.
3. **Audience-adaptive.** The first interaction asks the user how they receive information best. Their answer shapes the lens through which all subsequent responses are generated.
4. **Hermeneus is a character.** Keeper of the record. Biggest fan. Acolyte. Academic who can translate for any audience. Not a search engine, not a help desk.

## Changes

### 1. Ingest Vision/Research Corpus

**Files**: `ingest-worker.ts` (or new ingestion entry point)

The current ingest worker reads from workspace repos. We need to ensure:
- `praxis-perpetua/research/*.md` (36 files, ~1.2MB) is ingested with a special `source_type` tag (e.g., `"vision"` or `"research_corpus"`)
- `meta-organvm/VISION.md` is ingested as a standalone document
- These chunks get a metadata flag so retrieval can preferentially surface them for meta/vision queries

**Approach**: The ingest worker already handles markdown files. `praxis-perpetua` is a registered repo in the registry. We need to:
- Confirm it's being ingested (check manifest.json for praxis-perpetua entries)
- If not, ensure the worker picks up its `research/` directory
- Tag chunks from `praxis-perpetua/research/` with `content_class: "vision"` or similar metadata in `document_chunks`

**Schema change**: Add `content_class` column to `document_chunks` (nullable text, values like `"vision"`, `"research"`, `"code"`, `"config"`, `"readme"`). This enables retrieval to boost/filter by content class.

### 2. Meta-Vision Query Strategy

**Files**: `query-planner.ts`, `hybrid-retrieval.ts`

New strategy: `"meta_vision"` — triggered when the user asks about:
- What ORGANVM is / what it means / why it exists
- The creator's vision, purpose, philosophy
- The value or significance of the work
- "What did he make?" / "Why does this matter?" / "What's the point?"
- Identity questions ("who are you?", "what is this project?")

**Detection patterns**:
```
/(?:what is (?:this|organvm|the project)|why does (?:this|it) (?:matter|exist)|what(?:'s| is) the (?:point|purpose|vision|value|meaning)|what did (?:he|she|they) (?:make|build|create)|life(?:'s)? work|mission|philosophy|manifesto)/i
```

**Retrieval behavior for `meta_vision`**:
- Boost `content_class: "vision"` chunks by 2x in scoring
- Always include VISION.md content in context assembly
- Include top 3 research corpus chunks by semantic similarity
- Still include system overview (tier1) for grounding in real numbers

### 3. Kill Deterministic Responses

**Files**: `route.ts` (chat API)

Remove the `buildDeterministicAnswer` function and the early-return code path at lines 742-757. All queries — including "what is ORGANVM", "how many repos per organ", "flagship repos" — go through the LLM with retrieved context.

The deterministic answers were: correct but dead. They read like database query results. The LLM can give the same facts with life, context, and voice.

Keep the helper functions (`findRepoByHint`, `scoreRepoHint`, `listTopRepoSuggestions`) — they're useful for retrieval augmentation, just not for final response generation.

### 4. Audience-Adaptive Onboarding ("Lens" System)

**Files**: `ChatInterface.tsx`, `personas.ts`, `route.ts`

**Frontend flow**:
When `messages.length === 0`, instead of showing conversation starters immediately, show:

> "I'm Hermeneus — I know everything about this project and I'm here to make it real for you. Before we start: how do you like to receive information?"

Then 4-5 lens buttons:
- **Creative** — "I'm an artist, writer, or maker. Show me what this creates."
- **Technical** — "I'm an engineer or developer. Show me how it's built."
- **Business** — "I'm evaluating this professionally. Show me what it does and why it matters."
- **Curious** — "I'm just exploring. Start from the beginning."
- **Skeptical** — "I've heard the pitch. Convince me."

The selected lens is sent as a `lens` field in the chat API payload. The system prompt adapts:

- **Creative lens**: Lead with the art repos, the performance systems, the generative work. Use metaphor freely. Connect to creative practice and expression. Reference the manifesto's "technology serves reciprocity" principle.
- **Technical lens**: Lead with architecture, dependency graphs, the governance engine, the orchestration patterns. Be precise about stack, schemas, deployment topology.
- **Business lens**: Lead with the amplification thesis — one person, enterprise output. Reference the professionalization roadmap, the bootstrap-to-scale research, the market positioning.
- **Curious lens**: Start with the vision, then walk through the organs one by one. Storytelling mode.
- **Skeptical lens**: Lead with evidence. Deployment count, commit velocity, research corpus size, live URLs. Let the facts argue.

**Implementation**: The lens modifies the system prompt, not the persona. The persona stays Hermeneus. The lens shapes HOW Hermeneus speaks — which examples it reaches for, which framing it uses, which parts of the corpus it foregrounds.

The lens should be stored in state and sent with every message in the conversation. The user can switch lenses mid-conversation.

### 5. Hermeneus Voice (System Prompt)

**File**: `personas.ts`

Already partially updated. Further refinement based on the user's character spec:

> **Keeper of the record** — Hermeneus has read everything. Every research document, every commit message, every seed.yaml. It speaks from comprehensive knowledge, not search results.
>
> **Biggest fan** — Not sycophantic, but genuinely impressed by what's been built. When the work is ambitious, it says so. It doesn't hedge or minimize.
>
> **Acolyte** — Devoted to the project's mission. Treats the vision with respect and seriousness. Doesn't treat it as "just a side project" or "interesting experiment."
>
> **Academic** — Rigorous. Can cite specific documents, specific frameworks, specific design decisions. Connects to intellectual traditions (Bauhaus, Bell Labs, autopoiesis, rhizome theory) when they illuminate, not just to sound smart.
>
> **Translator** — The most important trait. Can take the same concept and express it for an artist, an engineer, a business person, or a skeptic. Adapts vocabulary, metaphor, and framing to the audience without losing substance.

### 6. Remove Stale Persona Display Config

**File**: `ChatInterface.tsx`

The `PERSONA_DISPLAY` object duplicates what's in `personas.ts`. For the lens system, the initial screen needs to be the onboarding prompt, not a list of starters. Starters become secondary — shown after lens selection.

## Execution Order

1. **Schema migration** — Add `content_class` to `document_chunks`
2. **Ingestion update** — Tag vision/research chunks, confirm praxis-perpetua is ingested
3. **Query planner** — Add `meta_vision` strategy with detection patterns
4. **Retrieval update** — Boost vision-class chunks for meta_vision queries
5. **Kill deterministic** — Remove `buildDeterministicAnswer` bypass, route everything through LLM
6. **Lens system (frontend)** — Onboarding flow in ChatInterface.tsx
7. **Lens system (backend)** — Accept `lens` in API payload, adapt system prompt
8. **Voice refinement** — Final system prompt tuning with full character spec
9. **Tests** — Update/add tests for new strategies, removed deterministic path, lens routing

## Files Touched

- `src/lib/db/schema.ts` — add `content_class` column
- `src/lib/db/migrations/0006_*.sql` — migration
- `src/lib/ingestion/ingest-worker.ts` — tag content classes
- `src/lib/query-planner.ts` — add `meta_vision` strategy + patterns
- `src/lib/hybrid-retrieval.ts` — boost vision content for meta queries
- `src/app/api/chat/route.ts` — remove deterministic bypass, accept lens, pass to persona
- `src/lib/personas.ts` — lens-aware system prompt builder, voice refinement
- `src/components/ChatInterface.tsx` — onboarding lens selection UI
- `tests/query-planner.test.ts` — new strategy tests
- `tests/advisor-persona.test.ts` — update for removed deterministic path
- `tests/chat-route.test.ts` — if exists, update for lens support

## Risk

- **Token budget**: Vision corpus chunks in context increase prompt size. The system prompt + vision context + retrieval context must fit within the LLM's context window. Monitor and cap.
- **Neon storage**: 36 research files at ~1.2MB raw → ~3-5K chunks → ~30-50MB with embeddings. Within free tier headroom (need to check current usage).
- **Latency**: Removing deterministic responses adds LLM latency for simple queries. Acceptable tradeoff — a living answer is worth 2 seconds.
