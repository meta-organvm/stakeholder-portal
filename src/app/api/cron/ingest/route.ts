import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { documentChunks, connectorCursors } from "@/lib/db/schema";
import { sql, lt } from "drizzle-orm";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getProvidedCronSecret(request: Request): string | null {
  const header = request.headers.get("x-cron-secret");
  if (header) return header;
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7);
  return null;
}

function secretsMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, "utf-8");
  const providedBuf = Buffer.from(provided, "utf-8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * POST /api/cron/ingest
 *
 * Triggers incremental vector ingestion status report.
 * Since actual file reading requires local workspace access (not available on Vercel),
 * this endpoint provides ingestion health metrics and staleness analysis.
 *
 * For full ingestion, run `npm run generate -- --incremental` locally.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return json({ error: "CRON_SECRET not configured" }, 500);
  }

  const provided = getProvidedCronSecret(request);
  if (!secretsMatch(cronSecret, provided)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    // Gather ingestion health metrics
    const [chunkStats] = await db
      .select({
        total: sql<number>`count(*)`,
        repos: sql<number>`count(distinct repo)`,
        oldest: sql<string>`min(ingested_at)`,
        newest: sql<string>`max(ingested_at)`,
        staleCount: sql<number>`count(*) filter (where ingested_at < now() - interval '7 days')`,
      })
      .from(documentChunks);

    const cursors = await db
      .select({
        connectorId: connectorCursors.connectorId,
        cursor: connectorCursors.cursor,
        lastSyncAt: connectorCursors.lastSyncAt,
      })
      .from(connectorCursors)
      .where(sql`${connectorCursors.connectorId} like 'vector:%'`);

    const staleCursors = cursors.filter((c) => {
      if (!c.lastSyncAt) return true;
      const age = Date.now() - new Date(c.lastSyncAt).getTime();
      return age > 7 * 24 * 60 * 60 * 1000;
    });

    // Mark chunks older than 30 days for review
    const [expiredResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(documentChunks)
      .where(lt(documentChunks.ingestedAt, sql`now() - interval '30 days'`));

    const report = {
      status: "ok",
      timestamp: new Date().toISOString(),
      chunks: {
        total: Number(chunkStats?.total ?? 0),
        repos: Number(chunkStats?.repos ?? 0),
        oldest_ingested: chunkStats?.oldest ?? null,
        newest_ingested: chunkStats?.newest ?? null,
        stale_7d: Number(chunkStats?.staleCount ?? 0),
        expired_30d: Number(expiredResult?.count ?? 0),
      },
      cursors: {
        total: cursors.length,
        stale: staleCursors.length,
        repos_needing_sync: staleCursors.map((c) => c.connectorId.replace("vector:", "")),
      },
      recommendation: staleCursors.length > 5
        ? "Run `npm run generate -- --incremental` to re-sync stale repos"
        : "Ingestion is current",
    };

    return json(report);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return json({ error: "Ingestion health check failed", detail: msg }, 500);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
