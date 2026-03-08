# Stakeholder Portal: Full Audit, Test Remediation & Evaluation-to-Growth

## Summary

Full audit of the stakeholder-portal codebase confirms **all source code is fully implemented** — no stubs, skeletons, or placeholder functions exist. The codebase has 36 lib modules, 7 API routes, 29 test files (161 tests), and 7 scripts.

**Issues found:**
1. **6 failing tests** in `chat-route.test.ts` — caused by the recently-added `knowledge-base-connector.ts` making an unmocked `fetch()` call during `hybridRetrieve()`, inflating call-count assertions.
2. **7 source modules lack dedicated tests** — `hybrid-retrieval.ts`, `retrieval.ts`, `knowledge-base-connector.ts`, `queue.ts`, `connectors/docs.ts`, `connectors/slack.ts`, `connectors/types.ts`.

---

## Proposed Changes

### Fix: Chat Route Tests

#### [MODIFY] [chat-route.test.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/tests/chat-route.test.ts)

Add a mock for `@/lib/hybrid-retrieval` at the top of the test file (alongside the existing `@/lib/retrieval` mock) so that `hybridRetrieve` returns a deterministic result without calling `fetchFederatedKnowledge` (which uses the real `fetch`). This prevents the extra fetch call that breaks call-count assertions.

```typescript
vi.mock("@/lib/hybrid-retrieval", () => ({
  hybridRetrieve: vi.fn().mockResolvedValue({
    query: "test",
    sources: [],
    context: "mocked context",
    tier1: "tier1",
    strategy: "hybrid",
    total_candidates: 0,
  }),
  resetHybridRetrievalCache: vi.fn(),
}));
```

---

### New Test Files

#### [NEW] [hybrid-retrieval.test.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/tests/hybrid-retrieval.test.ts)

Tests for the hybrid retrieval engine:
- `tokenize()` — word splitting, stop-word removal
- `computeTfIdf()` — TF-IDF scoring correctness
- `scoreLexical()` — repo lexical score computation
- `computeFreshness()` — date-based freshness scoring
- `assembleContext()` — context string assembly
- `rewriteQuery()` — stop-word stripping
- Cache behavior — cache hit, expiry, reset
- `hybridRetrieve()` integration — mock `fetchFederatedKnowledge` and verify merged results

#### [NEW] [retrieval.test.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/tests/retrieval.test.ts)

Tests for the original retrieval module:
- `buildTier1Context()` — returns expected system summary structure
- `buildTier2Context()` — organ-specific, keyword-scored, and fallback paths
- `searchRepos()` — keyword matching, filters, empty query

#### [NEW] [knowledge-base-connector.test.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/tests/knowledge-base-connector.test.ts)

Tests for the federated knowledge base connector:
- Returns `[]` when disabled (env flag off)
- Returns `[]` when no API URL configured
- Returns mapped `RetrievalSource[]` on success (mock fetch)
- Returns `[]` on API error (non-200 response)
- Returns `[]` on timeout (abort controller)

#### [NEW] [queue.test.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/tests/queue.test.ts)

Tests for the job queue (using the mocked DB from `setup.ts`):
- `enqueueJob()` — calls db insert with correct shape
- `nextRunAt()` — exponential backoff calculation (import and test directly)
- `completeJob()` / `failJob()` — calls db update

#### [NEW] [docs-connector.test.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/tests/docs-connector.test.ts)

Tests for the docs connector using temp directories:
- `sync()` — discovers and converts `.md` files to `IngestRecord`
- Incremental sync with `since` param filters by mtime
- Respects `maxFiles` limit
- `fileToRecord()` — correct record shape, title extraction

#### [NEW] [slack-connector.test.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/tests/slack-connector.test.ts)

Tests for the Slack connector with mocked fetch and DB:
- Returns `[]` when no token configured
- Returns `[]` when no channels configured
- `messageToRecord()` — correct IngestRecord shape
- `sync()` — calls Slack API, maps messages, updates cursor

#### [NEW] [connector-types.test.ts](file:///Users/4jp/Workspace/meta-organvm/stakeholder-portal/tests/connector-types.test.ts)

Tests for the connector registry:
- `registerConnector()` / `getConnector()` — round-trip
- `listConnectors()` — returns all registered
- `unregisterConnector()` — removes by ID
- `resetConnectors()` — clears all

---

## Verification Plan

### Automated Tests

```bash
# Run the full test suite — all tests must pass
npx vitest run

# Targeted: verify the fixed chat-route tests
npx vitest run tests/chat-route.test.ts

# Targeted: verify each new test file
npx vitest run tests/hybrid-retrieval.test.ts
npx vitest run tests/retrieval.test.ts
npx vitest run tests/knowledge-base-connector.test.ts
npx vitest run tests/queue.test.ts
npx vitest run tests/docs-connector.test.ts
npx vitest run tests/slack-connector.test.ts
npx vitest run tests/connector-types.test.ts
```

### Final Validation

- Run `npx vitest run` and confirm **0 failures** across all test files
- Confirm no new TypeScript compilation errors with `npx tsc --noEmit`
