import type { TestamentArtifact } from "@/data/testament";

interface ArtifactCardProps {
  artifact: TestamentArtifact;
}

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const svgPath = `/testament/${artifact.filename}`;

  return (
    <div className="group overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-accent)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest">
        <span className="text-[var(--color-accent)]">
          {artifact.organ ?? "system"}
        </span>
        <span className="text-[var(--color-text-muted)]">
          {artifact.modality}
        </span>
      </div>

      {/* SVG Preview */}
      <div className="flex items-center justify-center bg-[var(--color-bg)] p-2">
        {artifact.format === "svg" ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={svgPath}
            alt={artifact.title}
            className="h-auto max-h-[250px] w-full"
            loading="lazy"
          />
        ) : (
          <div className="flex h-[180px] items-center justify-center text-sm text-[var(--color-text-muted)]">
            {artifact.modality}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2">
        <h3 className="text-sm font-medium leading-tight">
          {artifact.title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {artifact.description}
        </p>
      </div>
    </div>
  );
}
