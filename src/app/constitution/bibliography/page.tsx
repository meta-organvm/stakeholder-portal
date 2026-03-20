import { getBibliographyTraditions, getMetrics } from "@/data/constitutional";
import { ConstitutionSubNav } from "@/components/constitution/ConstitutionSubNav";
import { BibliographyGrid } from "@/components/constitution/BibliographyGrid";

export default function BibliographyPage() {
  const traditions = getBibliographyTraditions();
  const metrics = getMetrics();
  const totalEntries = traditions.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Bibliography
        </h1>
        <p className="max-w-2xl text-[var(--color-text-secondary)]">
          {metrics.totalBibEntries} BibTeX entries across{" "}
          {traditions.length} academic traditions. Every specification traces to
          peer-reviewed literature.
        </p>
        <ConstitutionSubNav active="/constitution/bibliography" />
      </section>

      {/* Summary strip */}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div className="text-center">
            <div className="text-2xl font-bold tracking-tight">
              {totalEntries}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              BibTeX Entries
            </div>
          </div>
          <div className="h-8 w-px bg-[var(--color-border)]" />
          <div className="text-center">
            <div className="text-2xl font-bold tracking-tight">
              {traditions.length}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Traditions
            </div>
          </div>
          <div className="h-8 w-px bg-[var(--color-border)]" />
          <div className="text-center">
            <div className="text-2xl font-bold tracking-tight">
              {new Set(traditions.flatMap((t) => t.specs)).size}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Specs Grounded
            </div>
          </div>
        </div>
      </section>

      {/* Interactive tradition grid */}
      <BibliographyGrid traditions={traditions} />
    </div>
  );
}
