"use client";

import { useState } from "react";
import type { BibliographyTradition } from "@/data/constitutional";

function TraditionPill({
  tradition,
  isActive,
  onToggle,
}: {
  tradition: BibliographyTradition;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        isActive
          ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent-bright)]"
          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]"
      }`}
    >
      {tradition.name}
      <span className="ml-1.5 font-mono text-[10px] opacity-70">
        {tradition.count}
      </span>
    </button>
  );
}

function TraditionCard({
  tradition,
}: {
  tradition: BibliographyTradition;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[rgba(255,255,255,0.12)]">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-snug">
          {tradition.name}
        </h4>
        <span className="shrink-0 font-mono text-lg font-bold text-[var(--color-accent-bright)]">
          {tradition.count}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span>entries</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {tradition.specs.map((spec) => (
          <span
            key={spec}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-3)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--color-text-muted)]"
          >
            {spec}
          </span>
        ))}
      </div>

      {/* Proportional bar */}
      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)]/40 transition-all duration-500"
            style={{ width: `${(tradition.count / 17) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function BibliographyGrid({
  traditions,
}: {
  traditions: BibliographyTradition[];
}) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const filtered = activeFilter
    ? traditions.filter((t) => t.name === activeFilter)
    : traditions;

  return (
    <div className="space-y-6">
      {/* Filter pills */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Filter by Tradition
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveFilter(null)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              activeFilter === null
                ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent-bright)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            All
          </button>
          {traditions.map((t) => (
            <TraditionPill
              key={t.name}
              tradition={t}
              isActive={activeFilter === t.name}
              onToggle={() =>
                setActiveFilter((prev) =>
                  prev === t.name ? null : t.name
                )
              }
            />
          ))}
        </div>
      </section>

      {/* Tradition cards grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((tradition) => (
          <TraditionCard key={tradition.name} tradition={tradition} />
        ))}
      </div>
    </div>
  );
}
