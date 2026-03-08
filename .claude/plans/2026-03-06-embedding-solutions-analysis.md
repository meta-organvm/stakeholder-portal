# Embedding Solutions Analysis for Stakeholder Portal

## Comparison Matrix

| Aspect | Ollama | HuggingFace Inference API | transformers.js | Jina AI | Cohere |
|--------|--------|---------------------------|-----------------|---------|--------|
| **Vector Dimensions** | Model-dependent (768-1024 typical) | Model-dependent (384-1024) | Model-dependent (384-768) | 1024 | 1024 (Embed 3), 4096 (Embed 4) |
| **OpenAI API Format** | Yes ✓ (`/v1/embeddings`) | No (custom format) | No (custom API) | Yes ✓ (OpenAI-compatible) | Yes ✓ (custom endpoint) |
| **Local Ingestion** | Yes ✓ (native support) | Yes ✓ (via HTTP) | Yes ✓ (direct Node.js) | Yes ✓ (via API) | Yes ✓ (via API) |
| **Vercel Query-Time** | No ✗ (stateful server needed) | Yes ✓ (stateless HTTP) | Yes ✓ (bundled, no external deps) | Yes ✓ (stateless HTTP) | Yes ✓ (stateless HTTP) |
| **Free Tier** | Yes ✓ (open source) | Yes (credits/month) | Yes ✓ (open source) | Partial (10M token trial) | No (1K calls/month trial only) |
| **Rate Limits** | None (self-hosted) | Varies (inference queue) | None (local) | 100 RPM, 100K TPM | Trial: 1K calls/month |
| **Cost (Production)** | Free (server infra) | Free tier + usage-based | Free | $0/mo (10M free) or $10+/mo | Trial only; $0.12/M tokens (Embed 4) |
| **Production-Ready** | ⚠️ Conditional | ✓ (if on free tier) | ✓ (with careful optimization) | ✓ | ✗ (trial = non-production) |
| **Dimension Consistency** | ✓ Guaranteed (fixed model) | ✓ Guaranteed (fixed model) | ✓ Guaranteed (fixed model) | ✓ Guaranteed (1024) | ✗ (mixed across versions) |

---

## Detailed Analysis

### 1. Ollama
**Best for: Local ingestion only**

**Strengths:**
- True open-source, zero-cost foundation
- Native OpenAI-compatible `/v1/embeddings` endpoint
- Excellent ingestion-time performance (local GPU acceleration if available)
- No API key/network dependency during ingestion

**Critical Constraints:**
- **Vercel incompatibility** — Ollama runs as a stateful server; Vercel functions are ephemeral and cannot maintain a background Ollama instance. Each query would require launching Ollama (impossible within 15-second timeout) or connecting to external Ollama server (adds infrastructure cost, negates "free" requirement)
- Recommendation: **Use Ollama for ingestion only** (fast, free, local), but pair with a Vercel-compatible solution for query-time embeddings

---

### 2. HuggingFace Inference API
**Best for: Free tier with variable availability**

**Strengths:**
- Free tier available with monthly compute credits
- Supports multiple open-source embedding models (all-MiniLM-L6-v2, FlagEmbedding, E5)
- HTTP stateless API works perfectly on Vercel
- Automatic model caching/optimization

**Critical Constraints:**
- **No OpenAI endpoint compatibility** — Requires custom HTTP client code to call HF API, then parse response. Current codebase expects `/v1/embeddings` format
- **Free tier sustainability risk** — Free tier may be rate-limited or throttled during high-load periods. No published SLA for free tier
- **Inference queue delays** — Free tier inference may queue; acceptable for ingestion, problematic for real-time query if queue times exceed Vercel timeout
- Recommendation: **Viable if willing to refactor API client**, but free tier sustainability is uncertain

---

### 3. transformers.js
**Best for: True zero-dependency, serverless-native solution**

**Strengths:**
- Pure JavaScript/ONNX Runtime — no external API calls required
- Works perfectly on Vercel (stateless, no GPU needed)
- True zero cost (no API quotas, no rate limits)
- Vector dimensions guaranteed consistent across ingestion/query
- No API key exposure risk

**Critical Constraints:**
- **Bundle size & cold start** — ONNX models (e.g., all-MiniLM-L6-v2) are ~50MB; adds significant overhead to Vercel function bundle and increases cold-start latency. Typical cold start: 3-5 seconds (query timeout risk)
- **Ingestion performance** — Embedding 10,000 chunks on CPU will be very slow (~1-3 min depending on chunk size)
- **Memory constraints** — Large ONNX models require substantial memory; may exceed Vercel function memory limits on smaller tiers
- Recommendation: **Best technical choice for query-time**, but requires optimization (lazy loading, caching) and acceptance of slow ingestion

---

### 4. Jina AI
**Best for: Production free tier with OpenAI compatibility**

**Strengths:**
- **OpenAI-compatible endpoint** (`https://api.jina.ai/v1/embeddings`) — drop-in replacement for current code
- Free tier: 10M tokens in trial + 1M tokens/month with free API key (sufficient for ~10K queries/month)
- Consistent 1024-dim vectors
- Vercel-compatible (stateless HTTP)
- Bearer token auth (no secrets exposure risk)

**Critical Constraints:**
- **Rate limits** — 100 requests/min, 100K tokens/min, 2 concurrent requests. Ingestion of 10K chunks (~2.5M tokens) would take ~25 minutes due to rate limits
- **Sustainability** — 1M tokens/month free tier is tight; ~500 query embeddings at 2K tokens/query. Scales poorly if query volume increases
- **Free tier is limited** — Trial period required first; beyond that, must budget ~$10-30/month for production use
- Recommendation: **Best drop-in replacement for small production workload**, but costs escalate quickly above free tier

---

### 5. Cohere
**Best for: Evaluation only (not production)**

**Strengths:**
- Trial API key: 1,000 free calls/month
- High-quality embeddings (Embed 4: 4096-dim, $0.12/M tokens)
- Simple HTTP API

**Critical Constraints:**
- **Trial key = non-production** — Cohere explicitly prohibits production use of trial keys
- **Free tier is insufficient** — 1K calls/month ÷ ~500 production queries = no room for error; insufficient for even light production workload
- **Dimension fragmentation** — Embed 3 (1024-dim, text-only) vs. Embed 4 (4096-dim, $$ cost). Migration path would require re-embedding entire corpus
- Recommendation: **Not viable for production; dismiss**

---

## Recommendation for Stakeholder Portal

### Hybrid Approach: Ollama + Jina AI

**Ingestion (Local):**
- Use **Ollama** with a model like `nomic-embed-text` (768-dim) or `all-minilm` (384-dim)
- Runs locally, zero cost, supports OpenAI API format
- Single-command setup: `ollama pull nomic-embed-text && ollama serve`
- Execution time: ~3-5 minutes for 10,000 chunks (acceptable for `npm run generate`)

**Query-Time (Vercel):**
- Use **Jina AI** with free tier (`api.jina.ai/v1/embeddings`)
- Drop-in replacement for current OpenAI endpoint
- Set `EMBEDDING_API_URL=https://api.jina.ai/v1/embeddings` and `EMBEDDING_API_KEY=<free-key>`
- Rate limits (100 RPM) are acceptable for interactive chat workload

**Critical Implementation Detail:**
- **Dimension mismatch** — Ollama (768) ≠ Jina AI (1024). Must standardize:
  1. Use Jina AI for BOTH ingestion and query (slower ingestion, but guaranteed dimension consistency)
  2. OR use Ollama for both (requires Vercel compatibility workaround, e.g., external Ollama server)
  3. OR run a dimension reduction step post-ingestion (adds complexity, potential accuracy loss)

---

## Alternative: Pure transformers.js (All-in-One)

If willing to optimize bundle and accept slow ingestion:

1. **Ingestion**: Use transformers.js locally (slow but free)
2. **Query**: Same transformers.js model bundled into Vercel function (optimize with lazy-loading, model caching)
3. **Advantages**: True zero cost, no rate limits, guaranteed dimension consistency
4. **Drawbacks**: ~5-10 min ingestion time, potential cold-start timeouts (mitigate with warming)

---

## Decision Tree

```
IF cost must be absolutely zero AND willing to optimize infrastructure:
  → transformers.js (all-in-one, accept slow ingestion & cold starts)
ELSE IF want fastest path with minimal refactoring:
  → Ollama (ingestion) + Jina AI (query) + solve dimension mismatch
ELSE IF want pure serverless, no local setup:
  → HuggingFace Inference API (custom client) + monitor free tier stability
```

---

## Next Steps

1. **Verify current vector dimensions** in `src/lib/db/schema.ts` (1536 from OpenAI?)
2. **Choose ingestion + query pair** based on above analysis
3. **Update environment variables** in `.env.example`:
   - `EMBEDDING_API_URL` (Jina/HF/Ollama endpoint)
   - `EMBEDDING_API_KEY` (if applicable)
   - `EMBEDDING_MODEL` (if needed for custom client)
4. **Test embedding consistency** — run 10 test chunks through both ingestion and query paths, verify dimension match
5. **Performance test** — measure ingestion time, cold start latency, query embedding time
6. **Cost monitor** — set up alerts for free tier usage (Jina: 1M tokens/month)

