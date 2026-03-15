import { getOrgans, getOrgan, getReposByOrgan } from "@/lib/manifest";
import { RepoCard } from "@/components/RepoCard";
import { MetricCard } from "@/components/MetricCard";
import { ORGAN_COLORS } from "@/lib/organ-colors";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pulseSnapshots } from "@/lib/db/pulse-schema";
import { desc } from "drizzle-orm";

export function generateStaticParams() {
  return getOrgans().map((o) => ({ key: o.key }));
}

export default async function OrganDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const organ = getOrgan(key);
  if (!organ) notFound();

  const repos = getReposByOrgan(key);
  const color = ORGAN_COLORS[key] || "#64748b";

  // Per-organ metrics from pulse
  let organDensity: number | null = null;
  let gateRate: number | null = null;

  try {
    const latest = await db
      .select({
        organDensities: pulseSnapshots.organDensities,
        gateRates: pulseSnapshots.gateRates,
      })
      .from(pulseSnapshots)
      .orderBy(desc(pulseSnapshots.timestamp))
      .limit(1);

    if (latest.length > 0) {
      organDensity = latest[0].organDensities?.[key] ?? null;
      gateRate = latest[0].gateRates?.[key] ?? null;
    }
  } catch {
    // Neon not available
  }

  const flagships = repos.filter((r) => r.tier === "flagship");
  const standard = repos.filter((r) => r.tier === "standard");
  const other = repos.filter(
    (r) => r.tier !== "flagship" && r.tier !== "standard"
  );

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <div
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-sm text-[var(--color-text-muted)]">
            {organ.key}
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-bold">
          {organ.name}{" "}
          <span className="text-[var(--color-text-muted)]">
            ({organ.greek})
          </span>
        </h1>
        <p className="mt-2 text-[var(--color-text-muted)]">{organ.domain}</p>
        {organ.description && (
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {organ.description}
          </p>
        )}
        <div className="mt-3 text-sm">
          <span className="font-medium">{organ.repo_count}</span> repos
          <span className="mx-2 text-[var(--color-border)]">|</span>
          <span className="text-[var(--color-text-muted)]">
            {organ.status}
          </span>
        </div>
      </div>

      {/* Per-organ metrics */}
      {(organDensity !== null || gateRate !== null) && (
        <div className="flex gap-4">
          {organDensity !== null && (
            <MetricCard label="Density" value={`${(organDensity * 100).toFixed(0)}%`} />
          )}
          {gateRate !== null && (
            <MetricCard label="Gate Pass Rate" value={`${gateRate}%`} />
          )}
          <MetricCard label="Repositories" value={repos.length} />
        </div>
      )}

      {/* Aesthetic */}
      {organ.aesthetic.tone && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Aesthetic</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {organ.aesthetic.palette && (
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">
                  Palette
                </dt>
                <dd>{organ.aesthetic.palette}</dd>
              </div>
            )}
            {organ.aesthetic.tone && (
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">
                  Tone
                </dt>
                <dd>{organ.aesthetic.tone}</dd>
              </div>
            )}
            {organ.aesthetic.typography && (
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">
                  Typography
                </dt>
                <dd>{organ.aesthetic.typography}</dd>
              </div>
            )}
            {organ.aesthetic.visual && (
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">
                  Visual
                </dt>
                <dd>{organ.aesthetic.visual}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Flagship repos */}
      {flagships.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Flagship</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {flagships.map((r) => (
              <RepoCard key={r.slug} repo={r} />
            ))}
          </div>
        </section>
      )}

      {/* Standard repos */}
      {standard.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Standard</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {standard.map((r) => (
              <RepoCard key={r.slug} repo={r} />
            ))}
          </div>
        </section>
      )}

      {/* Other repos */}
      {other.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Other</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((r) => (
              <RepoCard key={r.slug} repo={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
