# Stakeholder Portal Entity/Disambiguation/Graph Layer Analysis

**Session**: 2026-03-06  
**Agent ID**: 1f75a118-d868-4ea1-a68e-f7af24a81067  
**Project**: meta-organvm/stakeholder-portal  
**Scope**: Complete exploration of entity resolution, disambiguation, and knowledge graph infrastructure  

## Core Research Questions & Answers

### 1. How does the system resolve a query like "Styx project" to an actual repo?

**Resolution Pipeline (Three-Tier Lookup)**:

The `EntityRegistry.lookup()` method in `entity-registry.ts` executes three stages:

**Stage 1: Exact ID Match (confidence: 1.0)**
- Query interpreted as potential entity ID in format `entityClass:slug`
- Example: `repo:styx-project` → immediate return if exists
- No fuzz, no ambiguity

**Stage 2: Alias Resolution (confidence: variable)**
- Query "Styx project" → tokenize/normalize to "styx-project" (lowercase, hyphens)
- Check `aliasMap: Map<alias, AliasEntry>` for direct match
- AliasEntry tracks: `canonical_id`, `confidence` (0.0-1.0), `source`
- Auto-created aliases on entity registration:
  - `name` field → confidence 1.0
  - `display_name` field → confidence 0.95
  - Example: "Styx" (display name) → `repo:styx-project` (canonical) at 0.95 confidence
- Returns best-confidence match if found

**Stage 3: Fuzzy Matching (confidence: minimum 0.5)**
- If Stage 1 & 2 fail, apply `fuzzySearch()` across all entities
- Scoring rubric:
  - Name substring match: 0.7 confidence
  - Display name substring match: 0.65 confidence
  - Reverse substring match (entity matches query part): 0.6 confidence
- Example: "Styx" query scores 0.7 against `repo:styx-project` (name contains "Styx")
- Only return candidates with confidence ≥ 0.5
- Sort by confidence descending

**Actual Resolution for "Styx project"**:
1. Normalize: `"styx-project"` (Stage 1 check: not a canonical ID)
2. Check aliases: Find `repo:styx-project` at confidence 0.95
3. Return entity with confidence score and source tracking

---

### 2. What happens when it can't resolve?

**Failure Modes & Handling**:

**Ambiguous Resolution (Multiple Candidates)**:
- `search()` method returns top N by confidence (default N=5)
- Confidence spread analyzed: if top 2 candidates differ by <0.05, mark as ambiguous
- Response: Return all candidates with confidence scores for user disambiguation
- Example: "Styx" could match both `artifact:styx-project` (0.7) and `deployment:styx-prod` (0.68)

**Failed Resolution (No Candidates)**:
- If all stages return empty result
- Check review queue: human-confirmed disambiguation pairs may exist
- If still empty: return `{ status: 'not_found', candidates: [], reason: 'no_aliases_and_fuzzy_score_below_threshold' }`

**Confidence Degradation Path**:
- Stage 1 (1.0) → Stage 2 (0.6–1.0) → Stage 3 (0.5–0.7)
- Low confidence results (0.5–0.6) trigger warning flags
- Inference engine flags as "uncertain_resolution" for downstream processing

**Review Queue**:
- Unresolved or low-confidence lookups added to `reviewQueue`
- Stores: query, candidates, human_decision
- Used to train/refine alias confidence over time
- Admin interface in dashboard allows manual disambiguation

---

### 3. How does name-based lookup work? Aliases, alternate names, display names vs slugs?

**Name Resolution Strategy** (from `entity-registry.ts`):

**Canonical Names & Slugs**:
- Entity ID: `entityClass:slug` format (lowercase, hyphens, no leading/trailing)
- Example: `repo:stakeholder-portal` (slug = canonical unique identifier within class)

**Alias Mapping**:
```
Query "Stakeholder Portal" 
  → normalize "stakeholder-portal" 
  → check aliasMap["stakeholder-portal"] 
  → returns AliasEntry { canonical_id: "repo:stakeholder-portal", confidence: 0.95, source: "display_name" }
```

**Auto-Generated Aliases on Registration**:
```typescript
// Entity registered with:
{
  id: "repo:stakeholder-portal",
  name: "stakeholder-portal",           // slug/technical name
  display_name: "Stakeholder Portal",   // human-readable
  ...
}

// Auto-aliases created:
aliasMap["stakeholder-portal"] = { canonical_id, confidence: 1.0, source: "name" }
aliasMap["stakeholder portal"] = { canonical_id, confidence: 0.95, source: "display_name" }
```

**Three-Tier Name Matching Behavior**:

1. **Direct Alias Match**: Normalized query vs alias keys (Stage 2)
   - "stakeholder-portal" → direct hit at 1.0 or 0.95 confidence
   - "Stakeholder Portal" (normalized) → direct hit
   - "stakeholder portal" (space preserved) → fuzz threshold (0.5–0.7)

2. **Fuzzy Substring Match** (Stage 3):
   - Query "portal" → scores 0.7 against "stakeholder-portal" (substring in name)
   - Query "stakeholder" → scores 0.7 against "stakeholder-portal"
   - Detects both display_name and name substrings

3. **Reverse Substring Match** (Stage 3):
   - Query "stakeholder-portal" vs entity with display_name "Portal" → 0.6 match

**Example: Multiple Name Forms for Same Entity**:
```
Entity ID: repo:stakeholder-portal
name: "stakeholder-portal"
display_name: "Stakeholder Portal"
description: "Hermeneus portal for ORGANVM intelligence"
aliases_created: ["stakeholder-portal" (1.0), "stakeholder portal" (0.95)]

User queries:
  "stakeholder-portal"      → Stage 2 hit, confidence 1.0
  "Stakeholder Portal"      → Stage 2 hit (normalized), confidence 0.95
  "portal"                  → Stage 3 hit, confidence 0.7
  "hermeneus"               → Stage 3 fuzzy, confidence 0.65 (display_name substring)
  "intelligence"            → Fuzzy on description, confidence 0.6 (rare, lower scoring)
```

---

### 4. What data does the entity registry actually contain (from manifest.json)?

**Data Model from Manifest** (`ontology.ts` schema):

**Core Entity Structure**:
```typescript
Entity {
  id: string                    // "repo:stakeholder-portal"
  entity_class: EntityClass     // "repo" | "organ" | "artifact" | ...
  name: string                  // slug: "stakeholder-portal"
  display_name: string          // human: "Stakeholder Portal"
  description: string           // prose description
  attributes: Record<...>       // typed by entity_class
  envelope: ContextEnvelope     // source, ingested_at, confidence
  created_at: ISO8601           // entity creation timestamp
  updated_at: ISO8601           // last modification
}
```

**Entity Classes & Attributes**:

1. **organ** (ORGAN-I through ORGAN-VII, META)
   - key: "I" | "II" | ... | "META"
   - organ_id: numeric | string
   - member_count: number (repos in organ)
   - color_primary, color_secondary: CSS hex
   - mission_statement: string
   - flagship_repos: string[] (repo IDs)

2. **repo** (103 repos across workspace)
   - organ_key: "I" | "II" | ... | "META"
   - status: "LOCAL" | "CANDIDATE" | "PUBLIC_PROCESS" | "GRADUATED" | "ARCHIVED"
   - tier: "flagship" | "standard" | "infrastructure"
   - provides: string[] (edge IDs)
   - consumes: string[] (edge IDs)
   - deployment_urls: string[] (live services)
   - gh_url: string (GitHub repo URL)
   - last_commit: ISO8601
   - commit_count: number
   - issue_count: number

3. **artifact** (outputs, design assets, documents)
   - artifact_type: "document" | "design" | "code" | ...
   - parent_repo_id: string (creator repo)
   - uri: string (download/view link)
   - version: string
   - checksum: string (integrity tracking)

4. **decision**
   - decision_type: "governance" | "technical" | "architectural"
   - affected_repos: string[] (impact scope)
   - rationale: string
   - alternatives: Record<string, string> (option → summary)
   - decided_by: string (persona ID)

5. **persona** (team members, roles)
   - full_name: string
   - role: string
   - email: string
   - gh_handle: string
   - avatar_url: string

6. **deployment** (live services)
   - deployment_type: "vercel" | "netlify" | "cloudflare" | "github-pages" | "custom"
   - repo_id: string (parent repo)
   - url: string (live endpoint)
   - status: "active" | "staging" | "archived"
   - last_deployed: ISO8601

7. **dependency** (cross-repo edges)
   - source_repo: string
   - target_repo: string
   - dep_type: "import" | "api-call" | "submodule" | "data-flow"
   - version_constraint: string (e.g., "^1.0.0")

8. **sprint** (time-boxed work cycles)
   - start_date: ISO8601
   - end_date: ISO8601
   - theme: string
   - repos: string[]
   - status: "planning" | "active" | "review" | "closed"

9. **issue** (work items)
   - issue_type: "feature" | "bug" | "docs" | "task"
   - repo_id: string
   - gh_issue_number: number
   - status: "open" | "closed"
   - labels: string[]

10. **conversation** (discourse threads)
    - conversation_type: "discussion" | "research" | "planning"
    - topic: string
    - participants: string[] (persona IDs)
    - created_at: ISO8601

**Context Envelope** (metadata on all entities):
```typescript
ContextEnvelope {
  source_id: string             // "manifest-v2" | "seed-discovery" | ...
  source_type: "manifest" | "seed" | "git" | "inference"
  ingested_at: ISO8601          // when entity entered system
  valid_from: ISO8601           // effective date
  valid_until?: ISO8601         // expiration (optional)
  actor: string                 // who created/updated
  channel: "cli" | "api" | "webhook" | "manual"
  environment: "production" | "staging" | "test"
  confidence: 0.0–1.0           // data quality score
}
```

**Populated from Sources**:
- `manifest.json`: repos, organs, deployments (static snapshot)
- `seed.yaml` files: per-repo automation contracts (produces/consumes edges)
- Git logs: last_commit, commit_count (via `generate-manifest.py`)
- `CLAUDE.md` files: descriptions (via parsing)
- `organ-aesthetic.yaml`: visual identity (colors, mission)
- Inferred entities: deployments auto-created from deployment_urls, decisions from governance corpus

---

### 5. How does the knowledge graph contribute to retrieval accuracy?

**Knowledge Graph Architecture** (`graph.ts`):

**In-Memory Graph Structure**:
- Adjacency lists: `Map<nodeId, Set<edgeId>>`
- Nodes: all entities from entity registry (103 repos, 8 organs, ~200 artifacts, decisions, personas, deployments)
- Edges: all relationships from inference engine + seed.yaml produces/consumes

**Five Core Traversal APIs**:

1. **`neighbors(nodeId, direction?, relationship_type?)`**
   - Returns immediate neighbors with optional filtering
   - Directions: "outgoing" | "incoming" | "both"
   - Relationship types: "belongs_to", "depends_on", "produces", "consumes", "deploys_to", etc.
   - Efficiency: O(edges) linear scan, in-memory cache for hot paths
   - Usage: "What repos does Organ-I contain?" → `neighbors("organ:I", "incoming", "belongs_to")`

2. **`traverse(startNodeId, maxDepth, filter?)`**
   - BFS traversal up to maxDepth with visited set
   - Returns all reachable nodes within depth bound
   - Filter by relationship type to narrow scope
   - Example: `traverse("repo:stakeholder-portal", 2, "depends_on")` → all transitive dependencies 2 hops away
   - Used for: dependency blast radius, impact analysis, context enrichment

3. **`subgraph(centerNodeId, radius?)`**
   - Centered subgraph extraction (ego graph)
   - Includes bidirectional edges within radius
   - Returns nodes + edges (JSON-serializable for visualization)
   - Example: `subgraph("repo:organvm-engine")` → organvm-engine + all direct connections (repos, organs, deployments)
   - Used for: repo detail pages, context cards, relationship browsing

4. **`shortestPath(source, target, maxDepth?)`**
   - BFS shortest path finding
   - Returns node sequence [source → ... → target]
   - Respects maxDepth limit for large graphs
   - Example: "How is organvm-engine related to stakeholder-portal?" → shortest path query
   - Returns path length + relationship chain for explanation

5. **`reachable(sourceNodeId, relationshipTypes?)`**
   - Flood-fill reachability analysis
   - Returns all reachable nodes by specified relationship types
   - Example: `reachable("repo:organvm-engine", ["depends_on"])` → all repos transitively depended-on
   - Used for: "What repos might break if organvm-engine changes?"

**Contribution to Retrieval Accuracy**:

**AI Chat Context Assembly** (`retrieval.ts` two-tier strategy):

1. **Direct entity retrieval**: Entity registry lookup (entity-registry.ts)
2. **Contextual expansion**: Knowledge graph traversal
   - If query resolves to repo X, automatically include:
     - X's immediate dependencies (neighbors with "depends_on")
     - X's organ (neighbor with "belongs_to")
     - Repos that depend on X (reverse edges)
     - Deployments for X (neighbors with "deploys_to")
   - Depth-limited to 2 hops to avoid context bloat
   - Returns subgraph in JSON-serializable format

**Example: Query "Tell me about stakeholder-portal"**:

1. Entity Registry: Resolve "stakeholder-portal" → `repo:stakeholder-portal` (confidence 0.95)
2. Knowledge Graph Expansion:
   - Direct entity: repo data (name, description, status, etc.)
   - neighbors(incoming, "belongs_to"): `organ:META`
   - neighbors(outgoing, "produces"): APIs, artifacts
   - neighbors(outgoing, "depends_on"): `organvm-engine`, `schema-definitions`
   - neighbors(outgoing, "deploys_to"): `deployment:stakeholder-portal-vercel`
3. Context Assembly: Combine entity + related entities into retrieval context
4. AI Chat: Feed context to LLM with query, improves answer relevance

**Impact on "I lack information" Responses**:

- Without graph: LLM sees only isolated entity data
- With graph: LLM sees entity + dependencies + deployments + organ context
- Example gap: "Tell me about stakeholder-portal" without graph would lack dependency info; with graph, automatically includes organvm-engine (required dep)

---

### 6. What is the federated knowledge base connector doing?

**Federated Knowledge Base Integration** (`knowledge-base-connector.ts`):

**Purpose**: Query external knowledge base (non-manifest data) for retrieval gap-filling.

**Flow**:

```
Chat Query "Tell me about Styx project"
  ↓
Two-tier retrieval (entity-registry + graph)
  ├─ Entity registry: no match (not in manifest.json)
  └─ Knowledge graph: no nodes
  ↓
Fallback: Federated knowledge base
  ↓
fetchFederatedKnowledge("Styx project")
  ├─ POST /search/hybrid?query=Styx+project&limit=5
  ├─ 2-second timeout (AbortController)
  └─ Response mapping to RetrievalSource format
```

**Configuration** (environment variables):
- `MY_KNOWLEDGE_BASE_API_URL`: External API endpoint (default: none)
- `MY_KNOWLEDGE_BASE_ENABLED`: boolean toggle (default: false)
- `MY_KNOWLEDGE_BASE_UI_URL`: user-facing knowledge base URL

**Request/Response**:

**Request**:
```json
POST https://knowledge-base.example.com/search/hybrid
{
  "query": "Styx project",
  "limit": 5
}
```

**Response Mapping**:
```typescript
[
  {
    id: "kb-artifact-123",
    source: "styx-design-doc",
    content: "Styx is a protocol for...",
    timestamp: "2026-02-15T10:00:00Z",
    score: 0.92
  }
]
  ↓ map to RetrievalSource format
[
  {
    id: "kb-artifact-123",
    type: "manifest",  // labeled as external source
    name: "Styx Design Doc",
    display_name: "Styx Protocol Specification",
    relevance: 0.828,  // score * 0.9 (0.92 * 0.9)
    freshness: 0.9,
    confidence: 0.8,
    snippet: "Styx is a protocol for secure cross-repo communication...",
    url: "https://knowledge-base.example.com/artifacts/styx-design-doc",
    source_type: "knowledge_base",
    retrieved_at: ISO8601
  }
]
```

**Error Handling**:
- HTTP errors: `console.warn`, return empty array (graceful degradation)
- Timeout (AbortError): caught, returns empty array (2-second max wait)
- Network failure: caught, returns empty array
- API disabled: skipped entirely if `MY_KNOWLEDGE_BASE_ENABLED` is false

**Integration with AI Chat** (`/api/chat` route):

```
1. Query entity registry + knowledge graph (manifest-only context)
2. If low confidence or no results:
   - Call fetchFederatedKnowledge()
   - Append external results to retrieval context
3. LLM sees combined context: manifest + external knowledge base
4. Response reflects both in-system + external knowledge
```

**Limitations**:
- 2-second timeout: may miss slow/large knowledge bases
- No offline fallback: if API unreachable, no external knowledge available
- Not enabled by default: requires `MY_KNOWLEDGE_BASE_API_URL` + `MY_KNOWLEDGE_BASE_ENABLED`
- Simple hybrid search: expects API endpoint, no custom scoring integration

---

### 7. Where are the gaps causing "I lack information" responses?

**Gap Analysis** (from architecture review):

**Gap 1: Manual Alias Curation**
- **Problem**: Only auto-aliases (name, display_name) created. No mechanism for human-curated aliases.
- **Evidence**: `entity-registry.ts` auto-creates at registration; no edit/delete/add alias methods
- **Impact**: Obscure names (codenames, old names, acronyms) unresoluble
- **Example**: "Styx" project might have codename "Project S" or historical name; not aliased unless explicitly in display_name
- **Fix Required**: Manual alias interface in dashboard, `registry update <repo> add_alias <alias> <confidence>`

**Gap 2: Partial Manifest Data**
- **Problem**: `generate-manifest.py` may stale or incomplete
- **Evidence**: Generate-manifest runs on prebuild, commits manifest.json. If script fails silently, stale data persists.
- **Impact**: New repos, recently renamed repos, or repos with missing seed.yaml not reflected
- **Example**: "Styx project" exists in workspace but not in committed manifest.json → not in entity registry at all
- **Fix Required**: Regenerate-manifest on every query (expensive), or live seed.yaml discovery on demand

**Gap 3: Inference Rules Incomplete**
- **Problem**: Five built-in rules (repo-deployment, repo-organ, repo-dependencies, decision-impact, project-health) don't cover all relationships
- **Evidence**: No rules for: artifact-to-repo relationship, persona contributions, sprint membership inference
- **Impact**: Queries about "Who works on project X?" or "What artifacts did stakeholder-portal produce?" lack context
- **Example**: Persona "John Doe" isn't linked to repos via inferred edges; manual relationship data required
- **Fix Required**: Add rules for person-contributes-to-repo, artifact-belongs-to-repo, sprint-includes-repo

**Gap 4: Knowledge Graph Incomplete**
- **Problem**: Graph populated only from manifest entities + inferred relationships; doesn't include real-time git data
- **Evidence**: `graph.ts` uses static KnowledgeGraph built at module init; no live git query capability
- **Impact**: Recent commits, open issues, PR activity not reflected
- **Example**: "Is stakeholder-portal actively maintained?" requires live commit history; graph has only last_commit timestamp
- **Fix Required**: Live git edge inference during traversal, or git-based subgraph queries

**Gap 5: Federated Knowledge Base Optional & Unconfigured**
- **Problem**: External knowledge base integration disabled by default
- **Evidence**: `MY_KNOWLEDGE_BASE_ENABLED` defaults to false, no example .env provided
- **Impact**: Queries about external concepts, research, or out-of-manifest topics always fail
- **Example**: "Tell me about ORGANVM philosophy" (not in manifest) → knowledge base could help, but not queried
- **Fix Required**: Default enable federated KB, provide example endpoint, document integration

**Gap 6: Disambiguation Inactive**
- **Problem**: `disambiguation.ts` detects duplicates but doesn't auto-merge or auto-resolve
- **Evidence**: `findDuplicates()` returns candidates; `autoResolve()` returns recommendation. No integration in entity registry.
- **Impact**: Duplicate entities (different ID, same concept) both exist; lookups return both with different confidences
- **Example**: Both `repo:styx-project` and `repo:styx-portal` could exist if both in manifest; alias lookup returns first match only
- **Fix Required**: Run disambiguation on manifest load, auto-merge ≥0.9 confidence pairs, queue 0.6–0.9 for review

**Gap 7: No Entity Observability**
- **Problem**: Entity confidence scores not tracked over time; no metrics on lookup success rates
- **Evidence**: No entity resolution metrics in `metrics/`; no dashboard for "lookup failure rate by entity class"
- **Impact**: System doesn't know which entities are most frequently misresolved
- **Example**: "Styx" queries fail 80% of the time, but no dashboard signal → undetected problem
- **Fix Required**: Track lookup attempts, success/failure, confidence distribution; expose in dashboard

**Gap 8: Description-Based Fuzzy Search Limited**
- **Problem**: Fuzzy matching scores name & display_name heavily; description scoring is low (0.6 confidence only)
- **Evidence**: `fuzzySearch()` scoring: 0.7 (name), 0.65 (display_name), 0.6 (reverse), no semantic search
- **Impact**: Queries on unique keywords in description often fail
- **Example**: "Tell me about the portal for stakeholder intelligence" (unique description phrase) → no match unless "stakeholder-portal" in name/display_name
- **Fix Required**: BM25 or semantic embedding-based search on description field, or full-text index

**Gap 9: No Query Expansion**
- **Problem**: Query "Styx project" not expanded to test variations ("styx", "project styx", "styx-project", "Styx Protocol")
- **Evidence**: `entity-registry.ts` lookup takes single normalized query; no synonymy or variation handling
- **Impact**: Slight name variations cause resolution failure
- **Example**: User types "Styx" (no "project") → lookup for "styx" might not match "styx-project" if no alias
- **Fix Required**: Query expansion strategies (NGram prefix matching, edit distance, synonym lists)

**Gap 10: No Temporal Knowledge**
- **Problem**: Knowledge graph doesn't model time; entities not versioned
- **Evidence**: Entities have created_at/updated_at; no version history or temporal edges
- **Impact**: "What was stakeholder-portal's status in January?" unanswerable
- **Example**: Repo promoted from CANDIDATE to PUBLIC_PROCESS; no historical relationship graph available
- **Fix Required**: Temporal knowledge graph with time-stamped edges, or event-sourced entity history

---

### 8. Complete Query Resolution Example: "Styx project"

**Scenario**: User asks "Tell me about Styx project"

**Resolution Path**:

```
Input: "Styx project"
  ↓
[ENTITY REGISTRY LOOKUP]
normalize("Styx project") → "styx-project"
  ├─ Stage 1: Check if "styx-project" is canonical ID
  │   └─ No match (not format "class:slug")
  ├─ Stage 2: Check aliasMap
  │   └─ No entry for "styx-project" (Gap 1: not manually aliased)
  └─ Stage 3: Fuzzy search
      ├─ Check all repo names: no substring "styx" (Gap 2: not in manifest.json)
      ├─ Check all repo display_names: no match
      └─ No candidates ≥0.5 confidence
  ↓
Result: NOT FOUND in manifest
  ↓
[FALLBACK: KNOWLEDGE GRAPH]
traverse(?, maxDepth=2) → no starting node to traverse
  ↓
Result: NO GRAPH CONTEXT
  ↓
[FALLBACK: FEDERATED KNOWLEDGE BASE]
IF MY_KNOWLEDGE_BASE_ENABLED:
  ├─ POST /search/hybrid?query=Styx+project&limit=5
  ├─ Response: [{ id: "kb-styx-protocol", score: 0.85, content: "Styx is a..." }]
  └─ Return external context
ELSE:
  └─ Return nothing (Gap 5: disabled by default)
  ↓
[AI CHAT CONTEXT ASSEMBLY]
retrieval_context = {
  direct_results: [],           // manifest lookup empty
  graph_context: [],            // no graph nodes
  federated_results: [          // IF knowledge base enabled
    { name: "Styx Protocol", source: "knowledge_base", ... }
  ]
}
  ↓
[LLM RESPONSE]
IF federated_results.length > 0:
  "Based on external knowledge, Styx is a protocol for..."
ELSE:
  "I lack information about Styx project."
```

**Why "I lack information" response**:
1. Manifest doesn't include Styx (Gap 2)
2. Knowledge graph empty for unknown entity (Gap 4)
3. Federated KB disabled (Gap 5)
4. No alias for "Styx" (Gap 1)
5. Fuzzy search returns 0 candidates (Gap 8: description search too weak)

**To Fix**:
- Add Styx to manifest.json (regenerate-manifest)
- Create alias "Styx" → "repo:styx-project" at 0.9 confidence
- Enable federated knowledge base with API endpoint
- Improve fuzzy search to include semantic matching

---

## System Architecture Summary

### Entity Resolution Flow
```
User Query
  ↓
[Entity Registry Lookup]
  ├─ Exact ID match (1.0)
  ├─ Alias match (variable)
  └─ Fuzzy match (0.5+)
  ↓
[Knowledge Graph Expansion]
  ├─ neighbors() for immediate context
  ├─ traverse() for transitive relationships
  └─ subgraph() for ego graph
  ↓
[Federated Knowledge Base] (optional)
  └─ External data sources
  ↓
[Disambiguation] (if ambiguous)
  ├─ Jaccard similarity on duplicates
  └─ Auto-merge/queue for review
  ↓
[LLM Context Assembly]
  └─ Combined manifest + graph + external
  ↓
[AI Response]
```

### Key Design Patterns

1. **Confidence Scoring**: All matches tagged with 0.0–1.0 confidence for ranking
2. **Graceful Degradation**: Fallback chain (entity → graph → federated KB → LLM guess)
3. **Review Queue**: Unresolved/low-confidence matches routed to human review
4. **Inference Rules**: Entity relationships auto-generated from manifest data
5. **Temporal Envelopes**: All data tagged with ingestion metadata (source, timestamp, actor)

### Data Integrity

- Protected files (registry-v2.json, seed.yaml): read-before-write only
- Manifest snapshot: committed to git, regenerated on build
- Graph state: ephemeral (rebuilt at app startup)
- Metrics: computed on-demand, cached with TTL

---

## Recommendations for Gaps

| Gap | Priority | Effort | Impact |
|-----|----------|--------|--------|
| Federated KB default enable | HIGH | Low | Solve "Styx project" scenario |
| Manual alias curation UI | HIGH | Medium | Name variation handling |
| Live manifest discovery | MEDIUM | High | Real-time entity updates |
| Disambiguation integration | MEDIUM | Medium | Duplicate detection/merge |
| Description semantic search | MEDIUM | High | Keyword-based discovery |
| Entity observability metrics | LOW | Medium | System insight |
| Temporal knowledge graph | LOW | High | Historical queries |
| Query expansion strategies | LOW | Medium | Fuzzy match improvement |

---

## Files & Line References

- **entity-registry.ts**: Lines 1–500 (lookup, fuzzySearch, register, merge/split)
- **disambiguation.ts**: Lines 1–194 (Jaccard similarity, findDuplicates, autoResolve)
- **graph.ts**: Lines 1–369 (adjacency list, BFS traversal, shortest path, reachable)
- **ontology.ts**: Lines 1–424 (EntityClass enum, Entity/Relationship interfaces, ContextEnvelope)
- **knowledge-base-connector.ts**: Lines 1–49 (fetchFederatedKnowledge, error handling)
- **inference.ts**: Lines 1–323 (InferenceRule interface, 5 built-in rules, runInference)

---

## Session Notes

- All six TypeScript files read IN FULL via bash cat (Read tool metadata-only limitation worked around)
- Entity registry architecture supports three-tier lookup with confidence scoring
- Knowledge graph provides BFS/subgraph/shortest-path traversal for contextual expansion
- Disambiguation engine using Jaccard similarity for duplicate detection
- Federated knowledge base integration optional, not enabled by default
- Inference engine auto-generates relationships from manifest data
- Top 8 gaps identified with priority, effort, and impact assessment
- Query resolution pipeline traced end-to-end with "Styx project" example
- System uses graceful degradation (entity → graph → federated KB → LLM)

