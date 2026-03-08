# Add Advisor Persona to Stakeholder Portal Chat

## Context

The stakeholder portal chat ("Hermeneus") was just fixed to be more helpful for **external collaborators**. Now the creator needs a second persona: an **omniscient strategic advisor** — a master of history, business strategy, systems design, and institutional governance who serves as a personal counselor. The creator iterates between extreme poles of experimentation and needs a voice that provides contextual awareness of dangers, breakthroughs, pitfalls, and historical parallels.

**Key distinction:** Hermeneus = external-facing information assistant. Advisor = creator-only strategic counselor. Same retrieval pipeline, radically different voice and purpose.

## Architecture Decision

**Minimal surface area.** The Advisor is a different system prompt + LLM parameters + starter prompts + auth gate, all threaded through the existing pipeline. No new routes, no new retrieval logic, no new database tables. The entire retrieval stack (hybrid retrieval, query planner, citations, knowledge graph) stays identical — the Advisor reinterprets the same evidence through a strategic lens.

## Implementation

### Step 1: Create `src/lib/personas.ts` — Persona config registry

New file. Defines a `PersonaConfig` type and exports configs for both personas:

```typescript
export type PersonaId = "hermeneus" | "advisor";

export interface PersonaConfig {
  id: PersonaId;
  displayName: string;
  placeholder: string;
  starters: string[];
  requiresAuth: boolean;
  modelConfig: { temperature: number; max_tokens: number };
  buildSystemPrompt: (ctx: { citationInstructions: string; tier1: string; context: string; closestMatchHint: string; totalRepos: number; totalOrgans: number }) => string;
}
```

**Hermeneus config:** Extract the existing system prompt from `route.ts` lines 808-833 into `buildSystemPrompt`. `temperature: 0.2`, `max_tokens: 1200`, `requiresAuth: false`.

**Advisor config:**
- `temperature: 0.45` (more creative/nuanced strategic responses)
- `max_tokens: 2400` (room for historical parallels and structured advice)
- `requiresAuth: true`
- System prompt voice: strategic counselor drawing from institutional history, business strategy, systems theory. Flags risks as navigable, names historical patterns, encourages bounded experimentation, references actual system state.
- Starters: `["What's the biggest risk to ORGANVM right now?", "Which organ needs the most attention?", "Am I over-engineering anything?", "What historical pattern does my system most resemble?", "Where should I focus this week for maximum leverage?", "What would break first under real external load?"]`

### Step 2: Modify `src/app/api/chat/route.ts` — Wire persona through pipeline

**A. Parse mode from request body:**
```typescript
const mode = (typeof body === "object" && body !== null && "mode" in body
  ? (body as { mode?: unknown }).mode
  : undefined) as string | undefined;
const personaId: PersonaId = mode === "advisor" ? "advisor" : "hermeneus";
const persona = getPersonaConfig(personaId);
```

**B. Auth gate for advisor mode** (after body parsing, before query planning):
If `persona.requiresAuth`, check auth using the existing pattern from `admin/intel/route.ts`:
- `getAdminSessionFromRequest(request)` — checks session cookie
- Fallback: `x-admin-token` header vs `ADMIN_API_TOKEN` env var
- If unauthorized, return `403 { error: "Advisor mode requires admin authentication" }`

**C. Parameterize `generateModelResponse`:**
Add optional `modelConfig` parameter:
```typescript
async function generateModelResponse(
  messages: ChatMessage[],
  systemPrompt: string,
  modelConfig?: { temperature?: number; max_tokens?: number }
): Promise<{ text: string; providerName: string }>
```
Use `modelConfig.temperature ?? 0.2` and `modelConfig.max_tokens ?? 1200` in the fetch body.

**D. Replace inline system prompt with persona template:**
```typescript
const systemPrompt = persona.buildSystemPrompt({
  citationInstructions,
  tier1: retrieval.tier1,
  context: retrieval.context,
  closestMatchHint,
  totalRepos: manifest.system.total_repos,
  totalOrgans: manifest.system.total_organs,
});
```

**E. Pass model config:**
```typescript
const providerResponse = await generateModelResponse(messages, systemPrompt, persona.modelConfig);
```

**F. Add persona to diagnostics:**
Add `persona: personaId` to the `ChatDiagnostics` type and `buildDiagnostics` calls.

### Step 3: Modify `src/components/ChatInterface.tsx` — Mode switching UI

**A. Add mode state** (same pattern as existing `showDiagnostics`):
```typescript
const [mode, setMode] = useState<"hermeneus" | "advisor">(() => {
  if (typeof window === "undefined") return "hermeneus";
  return new URLSearchParams(window.location.search).get("mode") === "advisor"
    ? "advisor" : "hermeneus";
});
```

**B. Send mode in request body:**
```typescript
body: JSON.stringify({
  messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
  mode,
}),
```

**C. Conditional starters and placeholder:**
Define `ADVISOR_STARTERS` alongside existing `STARTERS`. Render based on `mode`.

**D. Visual indicator:**
- Mode toggle button next to the sync indicator (small, tasteful)
- When in advisor mode: different heading ("Your Strategic Advisor"), different subtitle, different placeholder text
- Toggle updates URL param via `window.history.replaceState` for bookmarkability

**E. Auth handling for toggle:**
When toggling to advisor, make a lightweight GET to `/api/admin/intel` (already exists). If 401/503, redirect to `/admin/login` with a return URL. If ok, switch mode.

### Step 4: Update tests

**Existing tests (`tests/chat-route.test.ts`):** No changes needed. All existing tests send no `mode` field → default to `hermeneus` → identical behavior.

**New test file: `tests/advisor-persona.test.ts`:**
- Advisor mode returns 403 without admin credentials
- Advisor mode works with valid `ADMIN_API_TOKEN` header
- Default mode (no `mode` field) uses hermeneus persona
- Provider receives higher temperature/max_tokens for advisor mode
- System prompt contains advisor-specific text ("strategic counselor")

**Updated test file: `tests/chat-route.test.ts`:**
- Verify `body.mode` passthrough doesn't break existing tests (no changes needed, just verify)

### Step 5: Update `tests/query-planner.test.ts` (no changes)

The query planner is persona-agnostic — same classification regardless of mode.

## Files Modified

| File | Change |
|------|--------|
| `src/lib/personas.ts` | **NEW** — Persona config type, hermeneus + advisor configs with system prompts |
| `src/app/api/chat/route.ts` | Parse `body.mode`, auth gate, parameterized `generateModelResponse`, persona-driven system prompt |
| `src/components/ChatInterface.tsx` | Mode state from URL param, toggle UI, conditional starters/placeholder, mode in request body |
| `tests/advisor-persona.test.ts` | **NEW** — Auth gating, persona selection, parameter passthrough tests |

## Reuse inventory

| What | Where | How used |
|------|-------|----------|
| `getAdminSessionFromRequest()` | `src/lib/admin-auth.ts:96` | Auth gate for advisor mode |
| `ADMIN_API_TOKEN` env var check | `src/app/api/admin/intel/route.ts:91-107` | Pattern for header-based auth fallback |
| `?debug=1` URL param pattern | `src/components/ChatInterface.tsx:78-81` | Same pattern for `?mode=advisor` |
| Existing system prompt | `src/app/api/chat/route.ts:808-833` | Extracted into `personas.ts` as hermeneus config |
| `buildCitations`, `buildCitationInstructions` | `src/lib/citations.ts` | Same citation pipeline for both personas |
| `hybridRetrieve` | `src/lib/hybrid-retrieval.ts` | Same retrieval for both personas |

## Verification

1. `npm run test` — all existing 222 tests + new advisor tests pass
2. `npm run build` — build succeeds
3. Manual testing:
   - `/ask` — default Hermeneus mode, identical to current behavior
   - `/ask?mode=advisor` without admin session → toggle shows but API returns 403
   - `/ask?mode=advisor` with admin session → Advisor persona active, strategic voice, higher temperature responses
   - Toggle between modes mid-conversation → starters and placeholder update, new messages use correct persona
4. Verify advisor responses are substantively different: ask "What's the biggest risk?" in both modes — Hermeneus gives factual system overview, Advisor gives strategic assessment with historical parallels
