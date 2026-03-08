# Fix Ask Feature for External Collaborators

## Context

The stakeholder portal's Ask feature was designed to answer questions about the ORGANVM 111-repo system for **external collaborators** — people who aren't embedded in the project but need real answers about a fast-moving creative-institutional system. The creator iterates so fast with AI that they can't personally answer everyone's questions, so the portal is the answer.

**The problem:** The current pipeline has safety guardrails (citation enforcement, unsupported-claims gating, live_research blocking, deterministic intercepts) that are so aggressive they prevent the system from ever giving useful answers to reasonable questions. Three production examples:

1. *"Is the entire codespace indexed?"* → "does not provide sufficient information" (hedging non-answer)
2. *"What is unique about the Styx project?"* → "I lack information" (flat refusal)
3. *"By what other name has recursive-engine--generative-entity gone by?"* → identifies repo but won't share what it knows

**The shift:** From "prove every sentence or say nothing" → "be helpful with what you know, honest about what you don't."

## Root Causes

1. **Over-broad `live_research` regex** (`query-planner.ts:134`) — words like `current`, `latest`, `recent` block normal internal questions before the LLM ever sees them
2. **Citation `has_unsupported_claims` gate** (`citations.ts:124-137`) — patterns like `there are \d+` and `currently has` flag nearly every informative sentence as "unsupported"
3. **Insufficient-evidence gate** (`route.ts:854`) — when answerability ≠ "answerable" AND unsupported claims exist, the entire LLM response is thrown away and replaced with a generic refusal
4. **Deterministic intercepts** (`route.ts:219-243`) — "tech stack for Styx" returns a canned "could not find" instead of letting the LLM offer fuzzy matches
5. **System prompt too restrictive** — "Answer using ONLY the context below" + thin context = forced non-answers

## Implementation

### Step 1: Narrow `live_research` regex — `src/lib/query-planner.ts`

Replace the broad pattern at line 134:
```
/(?:market|news|competitor|latest|recent|current|today|real-time|search|find\s+out)/i
```
With a pattern that requires genuinely external intent:
```
/(?:market\s+(?:research|analysis|trends|share)|competitor\s+(?:analysis|news|comparison)|(?:news|headlines)\s+(?:about|on|for)|real-time\s+(?:data|feed)|search\s+(?:the\s+)?(?:web|internet|online))/i
```

Move `live_research` to **last** in the `PATTERNS` array so it's the last-resort classification, not a first-match interceptor. Normal queries with "current" or "latest" fall through to `exploratory` or repo-scoped strategies instead.

**Test impact:** `tests/query-planner.test.ts:62` — query "What is the latest competitor news today?" still matches because it contains "competitor news". `tests/chat-route.test.ts:331` — same query, still works.

### Step 2: Relax citation analysis — `src/lib/citations.ts`

**A. Narrow factual claim patterns** (line 124-131). Replace broad patterns with ones that catch real falsifiable claims:
```typescript
const factualPatterns = [
  /(?:exactly|precisely)\s+\d+/i,
  /\b(?:founded|created|launched)\s+(?:in|on)\s+\d{4}/i,
  /\bgenerat(?:es?|ing)\s+\$[\d,.]+/i,
  /\b\d+%\s+(?:increase|decrease|growth)/i,
];
```

**B. Change `has_unsupported_claims` to require threshold** — only true when >2 unsupported factual sentences AND >50% of factual sentences are uncited.

**Test impact:** `tests/citations.test.ts:90-96` — test text "There are 50 active repos. The system uses Python." will NO LONGER trigger unsupported claims (both sentences are too common/broad). Update the test to use a genuinely falsifiable claim like "The system was founded in 2019 and generates $5M annually."

### Step 3: Loosen insufficient-evidence gate — `src/app/api/chat/route.ts`

Replace the binary gate at line 854:
```typescript
if (queryPlan.answerability !== "answerable" && cited.has_unsupported_claims) {
```
With a graduated approach:
- **Block only when** zero retrieval sources AND `answerability === "unanswerable"` — genuinely nothing to work with
- **Append caveat when** sources exist but many claims are uncited — show the response with a disclaimer
- **Pass through otherwise** — trust the LLM with the context it was given

**Test impact:** `tests/chat-route.test.ts:346-372` — "blocks unsupported partial answers" test needs updating. The test sends a salary query (marked `partial` by planner), gets LLM response "There are 50 active repos", and expects it to be blocked. With the new logic:
- The `partial` classification still fires (salary triggers the outsidePatterns check)
- But `has_unsupported_claims` will be `false` (relaxed patterns from Step 2)
- So the response passes through — update test to either: (a) use a query that hits `unanswerable` with zero sources, or (b) assert the caveat is appended instead of full replacement

### Step 4: Rewrite system prompt — `src/app/api/chat/route.ts`

Replace the system prompt construction with one designed for external collaborators:
- Remove "ONLY" — replace with "Use context as your primary source"
- Add explicit permission: "Prefer a useful partial answer over a perfect non-answer"
- Define audience: "External collaborators, advisors, and partners"
- Keep the guardrail: "Never fabricate repository names, URLs, or technical details"
- Integrate the existing self-awareness block and closest-match hints as first-class sections
- Remove the separate `ANSWERABILITY CONSTRAINT` injection — it makes the LLM too conservative

### Step 5: Narrow deterministic intercepts — `src/app/api/chat/route.ts`

In `buildDeterministicAnswer`, change the "tech stack for X" handler (line 219-243):
- If repo found by exact slug match → return deterministic answer (keep)
- If repo NOT found → return `null` instead of "I could not find..." canned text → let the query fall through to the LLM with fuzzy matching via `closestMatchHint`

**Test impact:** `tests/chat-route.test.ts:314-325` — "returns deterministic tech stack fallback when repo is unknown" — this test expects `fetchMock` to NOT be called and the response to contain "I could not find a repository named **Styx**". With the change, the query falls through to the LLM, so `fetchMock` IS called. Update the test to verify the LLM receives the query and responds (or verify the provider is called).

### Step 6: Update starter prompts — `src/components/ChatInterface.tsx`

Replace the `STARTERS` array (line 65-72) with questions that demonstrate the system's strengths:
```typescript
const STARTERS = [
  "How is ORGANVM structured?",
  "What does organvm-engine do?",
  "How do the organs depend on each other?",
  "Which repos are most active right now?",
  "What's deployed in production?",
  "Tell me about the ingestion pipeline",
];
```

Update placeholder text to set expectations for collaborators.

## Files Modified

| File | Change |
|------|--------|
| `src/lib/query-planner.ts` | Narrow `live_research` regex, move to last in PATTERNS |
| `src/lib/citations.ts` | Narrow factual patterns, add threshold to `has_unsupported_claims` |
| `src/app/api/chat/route.ts` | Graduated evidence gate, rewritten system prompt, narrowed deterministic intercepts |
| `src/components/ChatInterface.tsx` | Updated starter prompts and placeholder text |
| `tests/chat-route.test.ts` | Updated: "Styx" test and "insufficient evidence" test expectations |
| `tests/citations.test.ts` | Updated: "unsupported claims" test input |

## Verification

1. `npm run test` — all 220 tests pass (with updated expectations)
2. `npm run build` — build succeeds
3. Manual test these queries locally (`npm run dev`):
   - "Is the entire codespace indexed?" → should get affirmative answer citing self-awareness
   - "What is unique about the Styx project?" → should get "no repo named Styx" + closest matches from LLM
   - "What is the current status of organvm-engine?" → should NOT be blocked as live_research
   - "What does the recursive engine do?" → should get real answer from context
4. Verify `GROQ_API_KEY` is set in Vercel production env (operational, not a code change)
