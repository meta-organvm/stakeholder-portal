import { getManifest, getMetrics } from "@/lib/manifest";
import { MetricGrid } from "@/components/MetricGrid";
import { Sparkline } from "@/components/Sparkline";
import { ORGAN_COLORS } from "@/lib/organ-colors";
import { db } from "@/lib/db";
import { pulseSnapshots } from "@/lib/db/pulse-schema";
import { desc, gte } from "drizzle-orm";

export default async function DashboardPage() {
  const manifest = getManifest();
  const metrics = getMetrics();

  // Live pulse data
  let pulseData: { density: number; entities: number; edges: number; tensions: number; clusters: number; timestamp: Date } | null = null;
  let densityHistory: number[] = [];

  try {
    const latest = await db
      .select()
      .from(pulseSnapshots)
      .orderBy(desc(pulseSnapshots.timestamp))
      .limit(1);

    if (latest.length > 0) {
      const s = latest[0];
      pulseData = {
        density: s.density,
        entities: s.entities,
        edges: s.edges,
        tensions: s.tensions,
        clusters: s.clusters,
        timestamp: s.timestamp,
      };
    }

    const since = new Date();
    since.setDate(since.getDate() - 7);
    const history = await db
      .select({ density: pulseSnapshots.density })
      .from(pulseSnapshots)
      .where(gte(pulseSnapshots.timestamp, since))
      .orderBy(pulseSnapshots.timestamp)
      .limit(500);

    densityHistory = history.map((h) => h.density);
  } catch {
    // Neon not available — pulse section won't render
  }

  // Promotion pipeline
  const promoStats: Record<string, number> = {};
  for (const r of manifest.repos) {
    promoStats[r.promotion_status] = (promoStats[r.promotion_status] || 0) + 1;
  }

  // Tier breakdown
  const tierStats: Record<string, number> = {};
  for (const r of manifest.repos) {
    tierStats[r.tier] = (tierStats[r.tier] || 0) + 1;
  }

  // CI health
  const withCI = manifest.repos.filter((r) => r.ci_workflow).length;
  const withoutCI = manifest.repos.length - withCI;

  // Top repos by commits
  const topByCommits = [...manifest.repos]
    .sort(
      (a, b) =>
        (b.git_stats.total_commits || 0) - (a.git_stats.total_commits || 0)
    )
    .slice(0, 10);

  // Top by velocity
  const topByVelocity = [...manifest.repos]
    .sort(
      (a, b) =>
        (b.git_stats.weekly_velocity || 0) - (a.git_stats.weekly_velocity || 0)
    )
    .slice(0, 10);

  const metricItems = [
    { label: "Total Repos", value: metrics.repos },
    { label: "Active Repos", value: metrics.activeRepos },
    { label: "Sprints", value: metrics.sprints },
    { label: "CI Workflows", value: metrics.ciWorkflows },
    { label: "Deployments", value: metrics.deployments },
    { label: "Dep. Edges", value: metrics.depEdges },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          System health and metrics
        </p>
      </div>

      <MetricGrid metrics={metricItems} />

      {/* Live System Pulse */}
      {pulseData && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            System Pulse
            <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
              {pulseData.timestamp.toLocaleString()}
            </span>
          </h2>
          <MetricGrid
            metrics={[
              { label: "Density", value: `${(pulseData.density * 100).toFixed(0)}%` },
              { label: "Entities", value: pulseData.entities },
              { label: "Edges", value: pulseData.edges },
              { label: "Tensions", value: pulseData.tensions },
              { label: "Clusters", value: pulseData.clusters },
            ]}
          />
          {densityHistory.length >= 2 && (
            <div className="mt-2">
              <Sparkline
                values={densityHistory}
                width={300}
                height={48}
                color="var(--color-accent, #3b82f6)"
              />
              <div className="text-xs text-[var(--color-text-muted)]">
                Density over 7 days ({densityHistory.length} samples)
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Promotion Pipeline */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="mb-4 text-lg font-semibold">Promotion Pipeline</h2>
          <div className="space-y-3">
            {["GRADUATED", "PUBLIC_PROCESS", "CANDIDATE", "LOCAL", "ARCHIVED"].map(
              (status) => {
                const count = promoStats[status] || 0;
                const pct = Math.round(
                  (count / manifest.repos.length) * 100
                );
                return (
                  <div key={status}>
                    <div className="flex justify-between text-sm">
                      <span>{status}</span>
                      <span className="text-[var(--color-text-muted)]">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>

        {/* CI Health */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="mb-4 text-lg font-semibold">CI Health</h2>
          <div className="flex items-center gap-8">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-400">{withCI}</div>
              <div className="text-xs text-[var(--color-text-muted)]">
                With CI
              </div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[var(--color-text-muted)]">
                {withoutCI}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Without CI
              </div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">
                {Math.round((withCI / manifest.repos.length) * 100)}%
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Coverage
              </div>
            </div>
          </div>

          <h3 className="mb-2 mt-6 text-sm font-semibold">Tier Breakdown</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(tierStats).map(([tier, count]) => (
              <div
                key={tier}
                className="flex justify-between rounded bg-[var(--color-surface-2)] px-3 py-1.5 text-sm"
              >
                <span className="capitalize">{tier}</span>
                <span className="text-[var(--color-text-muted)]">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-organ repos */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="mb-4 text-lg font-semibold">Repos per Organ</h2>
          <div className="space-y-2">
            {manifest.organs.map((organ) => {
              const color = ORGAN_COLORS[organ.key] || "#64748b";
              const pct = Math.round(
                (organ.repo_count / manifest.repos.length) * 100
              );
              return (
                <div key={organ.key}>
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      {organ.name}
                    </span>
                    <span className="text-[var(--color-text-muted)]">
                      {organ.repo_count}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sprint timeline */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="mb-4 text-lg font-semibold">Sprint History</h2>
          <div className="flex flex-wrap gap-1.5">
            {manifest.system.sprint_names.map((name) => (
              <span
                key={name}
                className="rounded bg-[var(--color-surface-2)] px-2 py-1 text-xs"
              >
                {name}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            {manifest.system.sprints_completed} sprints since launch (
            {manifest.system.launch_date})
          </p>
        </div>
      </div>

      {/* Top repos tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="mb-3 text-lg font-semibold">Top by Commits</h2>
          <table className="w-full text-sm">
            <tbody>
              {topByCommits.map((r) => (
                <tr key={r.slug} className="border-t border-[var(--color-border)]">
                  <td className="py-1.5">
                    <a
                      href={`/repos/${r.slug}`}
                      className="text-[var(--color-accent)] hover:underline"
                    >
                      {r.display_name}
                    </a>
                  </td>
                  <td className="py-1.5 text-right text-[var(--color-text-muted)]">
                    {r.git_stats.total_commits}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="mb-3 text-lg font-semibold">Top by Velocity</h2>
          <table className="w-full text-sm">
            <tbody>
              {topByVelocity.map((r) => (
                <tr key={r.slug} className="border-t border-[var(--color-border)]">
                  <td className="py-1.5">
                    <a
                      href={`/repos/${r.slug}`}
                      className="text-[var(--color-accent)] hover:underline"
                    >
                      {r.display_name}
                    </a>
                  </td>
                  <td className="py-1.5 text-right text-[var(--color-text-muted)]">
                    {r.git_stats.weekly_velocity}/wk
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
