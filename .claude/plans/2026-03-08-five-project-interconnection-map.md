# Five-Project Interconnection Map

**Date**: 2026-03-08
**Scope**: Cross-organ wiring between stakeholder-portal and five key projects

## The Five Projects

### 1. collective-persona-operations (ORGAN-I / Theory)
**What it is**: The SOP corpus — 22+ Standard Operating Procedures governing how the entire system operates (cross-agent handoff, promotion transitions, research-to-implementation pipeline, session self-critique, stranger test protocol, etc.). This is the institutional memory of *how things are done*.

**Current state**: CANDIDATE, mixed language. Produces theory. Consumes nothing.

### 2. my-knowledge-base (ORGAN-I / Theory)
**What it is**: A TypeScript knowledge base that exports Claude.app/Gemini conversations, atomizes them into knowledge units, and provides multi-layered search (FTS5 + semantic + hybrid via Reciprocal Rank Fusion) with Claude-powered intelligence extraction (insights, smart tags, relationship detection, summarization). 187/235 tasks complete (80%).

**Current state**: CANDIDATE, TypeScript. SQLite + ChromaDB. Has a web UI and API.

### 3. linguistic-atomization-framework (ORGAN-I / Theory)
**What it is**: LingFrame — transforms text into hierarchical structures (theme → paragraph → sentence → word → letter) and runs specialized analysis pipelines generating interactive visualizations. Supports military, literary, technical domains. Streamlit web UI + CLI.

**Current state**: CANDIDATE, Python. spaCy NLP + Streamlit.

### 4. portfolio/consult (PERSONAL)
**What it is**: "Capability Mapping" — a page on the portfolio site that maps organizational challenges to the 91-repo system through AI-powered capability analysis. Built with Astro. This is the *outward-facing* version of what Hermeneus does *inward-facing*.

**Current state**: PUBLIC_PROCESS, deployed at 4444j99.github.io/portfolio/consult/

### 5. agentic-titan (ORGAN-IV / Orchestration)
**What it is**: Polymorphic Agent Swarm Architecture — model-agnostic, self-organizing multi-agent system with 6 topologies, 1,095+ tests, 18 completed phases. The flagship orchestration engine. Consumes recursive-engine from ORGAN-I, produces for agent--claude-smith and public-process.

**Current state**: PUBLIC_PROCESS (flagship), Python. Has MCP adapters, gateway, dashboard, CLI.

---

## Interconnection Map

### Tier 1: Immediate Wirings (stakeholder-portal ↔ projects)

#### A. collective-persona-operations → stakeholder-portal
**The wiring**: The SOPs are the institutional voice. Hermeneus should be able to answer "how does promotion work?" or "what's the process for deploying a new repo?" by retrieving from the SOP corpus — not guessing.

**Implementation**:
- Ingest `collective-persona-operations/` SOPs into the vector store with `content_class: "sop"`
- Add SOP-class boosting to the query planner when queries match process/procedure/how-to patterns
- The Hermeneus persona already knows it's a "keeper of the record" — the SOPs make that literal

#### B. my-knowledge-base → stakeholder-portal
**The wiring**: Already partially connected via `MY_KNOWLEDGE_BASE_API_URL` env var and the federated knowledge retrieval strategy. But it's a thin pipe — Hermeneus asks my-knowledge-base for search results but doesn't deeply integrate.

**Deeper integration**:
- my-knowledge-base contains the creator's actual conversation history — their thought process, decisions, debugging sessions. This is the *creator's voice* in raw form.
- The stakeholder portal's federated retrieval should weight knowledge-base results higher for meta_vision queries
- Consider importing my-knowledge-base's insight extractions and relationship maps as a graph overlay in the portal's knowledge graph

#### C. linguistic-atomization-framework → stakeholder-portal
**The wiring**: LingFrame's text analysis capability could power Hermeneus's analytics strategy. Instead of raw `ts_stat` word frequency queries, run actual linguistic analysis — hierarchical decomposition, domain-specific patterns, thematic extraction.

**Implementation options**:
- **Light**: Ingest LingFrame's output artifacts (analysis reports, visualizations) into the vector store so Hermeneus can reference them
- **Medium**: Expose a LingFrame API endpoint that the portal calls for analytics queries
- **Heavy**: Run LingFrame's atomizer on the portal's own corpus (all ingested chunks) to produce thematic maps

#### D. portfolio/consult → stakeholder-portal
**The wiring**: These are mirrors of each other. Consult is the outward-facing capability mapper for stakeholders. Hermeneus is the inward-facing intelligence layer. They should share:
- The same manifest data
- The same capability taxonomy
- Cross-links: Hermeneus responses should link to consult for the public-facing framing; consult should link to the portal for deep dives

**Implementation**:
- Shared manifest endpoint or build artifact
- Hermeneus's "business" lens should reference consult as the professional-facing entry point
- The consult page could embed a lightweight version of the Hermeneus chat

#### E. agentic-titan → stakeholder-portal
**The wiring**: agentic-titan is the execution layer. The stakeholder portal observes and reports; agentic-titan acts. The connection points:
- **Status reporting**: The portal should surface agentic-titan's agent swarm status, topology, and active tasks
- **Capability mapping**: When Hermeneus answers "how does orchestration work?", it should cite agentic-titan's actual architecture, topologies, and test coverage (1,095+ tests)
- **MCP bridge**: agentic-titan has MCP adapters. The portal has an MCP server (organvm-mcp). These should be aware of each other.

### Tier 2: Cross-Project Wirings (between the five)

#### F. agentic-titan ↔ my-knowledge-base
agentic-titan's agents should be able to query my-knowledge-base for context during task execution. my-knowledge-base's relationship detector could map agentic-titan's agent interaction patterns.

#### G. linguistic-atomization-framework ↔ my-knowledge-base
LingFrame should be able to atomize my-knowledge-base's conversation exports. The atomized output becomes another layer of searchable knowledge — hierarchical themes from the creator's actual conversations.

#### H. collective-persona-operations ↔ agentic-titan
The SOPs define how agents should behave. agentic-titan should consume the SOP corpus as operational constraints — not just as documentation, but as executable governance rules.

#### I. portfolio/consult ↔ agentic-titan
The consult page's capability mapping should be informed by agentic-titan's actual active capabilities — not a static list. When new agent topologies come online, the consult page should reflect them.

### Tier 3: The Meta-Connection

All five projects converge on one thesis: **the system describes itself, governs itself, and presents itself**.
- collective-persona-operations: how it governs itself (SOPs)
- my-knowledge-base: how it remembers itself (conversation history)
- linguistic-atomization-framework: how it analyzes itself (text decomposition)
- portfolio/consult: how it presents itself (capability mapping)
- agentic-titan: how it executes itself (agent orchestration)
- stakeholder-portal (Hermeneus): how it explains itself (intelligence layer)

## Recommended Execution Order

1. **Ingest SOPs** (collective-persona-operations → portal vector store) — highest impact, straightforward
2. **Deepen federated knowledge-base integration** — already wired, just needs boosting for meta_vision
3. **Cross-link consult ↔ portal** — shared manifest, reciprocal links
4. **Ingest agentic-titan architecture docs** — ensure the flagship orchestration project is richly represented
5. **LingFrame analytics integration** — most ambitious, defer until core wirings are solid

## seed.yaml Updates Needed

The current seed.yaml files for these projects have generic `produces` descriptions. They should be updated to reflect actual cross-organ edges:

- `my-knowledge-base`: should declare `produces: knowledge_api` consumed by `stakeholder-portal`
- `collective-persona-operations`: should declare `produces: sop_corpus` consumed by `stakeholder-portal`, `agentic-titan`
- `stakeholder-portal`: should declare `consumes: knowledge_api, sop_corpus, agent_status`
- `agentic-titan`: should declare `produces: agent_status` consumed by `stakeholder-portal`
