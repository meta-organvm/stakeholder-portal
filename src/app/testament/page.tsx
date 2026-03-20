import {
  SYSTEM_ARTIFACTS,
  ORGAN_CARDS,
  MODALITIES,
  getTestamentStats,
} from "@/data/testament";
import { ArtifactCard } from "@/components/testament/ArtifactCard";

function MetricCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{label}</div>
    </div>
  );
}

export default function TestamentPage() {
  const stats = getTestamentStats();

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          The Generative Testament
        </h1>
        <p className="max-w-3xl text-[var(--color-text-secondary)]">
          Every computational function in ORGANVM is also a generative function.
          The system renders its own density into experience — producing visual
          art, schematics, statistics, sonic parameters, and prose from the same
          algorithms that govern its operation.
        </p>
        <p className="text-xs text-[var(--color-text-muted)]">
          INST-GENERATIVE-TESTAMENT · INV-TESTAMENT-001 (Generative Completeness)
        </p>
      </section>

      {/* Metrics strip */}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <MetricCell label="Total Artifacts" value={stats.totalArtifacts} />
          <MetricCell label="Modalities" value={stats.modalities} />
          <MetricCell label="System Portraits" value={stats.systemArtifacts} />
          <MetricCell label="Organ Cards" value={stats.organCards} />
        </div>
      </section>

      {/* Modality register */}
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Output Modality Register
        </h2>
        <div className="flex flex-wrap gap-2">
          {MODALITIES.map((m) => (
            <span
              key={m.key}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs"
            >
              <span className="text-[var(--color-accent)]">{m.icon}</span>
              {m.label}
            </span>
          ))}
        </div>
      </section>

      {/* System-level artifacts */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          System Self-Portrait
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-muted)]">
          The system describing itself across multiple media — every artifact
          generated from live registry data by the testament pipeline.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SYSTEM_ARTIFACTS.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
        </div>
      </section>

      {/* Organ identity cards */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          Organ Identity Cards
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-muted)]">
          Each organ rendered as an SVG identity card — repo count, flagship
          count, promotion status, all derived from the live registry.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ORGAN_CARDS.map((card) => (
            <ArtifactCard key={card.id} artifact={card} />
          ))}
        </div>
      </section>

      {/* Constitutional grounding */}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Constitutional Grounding
        </h2>
        <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
          <p>
            The generative testament is grounded in a 2,400-year intellectual
            genealogy — from Aristotle&apos;s self-moving movers through Llull&apos;s{" "}
            <em>Ars Magna</em>, Kant&apos;s self-organizing nature, Maturana and
            Varela&apos;s autopoiesis, Luhmann&apos;s system self-description, to
            Galanter&apos;s generative art. 46 classified claims across 17 academic
            sources. 5 novel claims. 0 contested.
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            &ldquo;A system that wants self-presence must maintain an active
            cosmology of itself.&rdquo; — Virtual-System-Architecture transcript
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border)] pt-4 text-center text-xs text-[var(--color-text-muted)]">
        ORGANVM TESTAMENT — structural self-awareness through continuous
        self-description
      </footer>
    </div>
  );
}
