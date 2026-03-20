import { getPreprints, getAuthorOrcid } from "@/data/constitutional";
import { ConstitutionSubNav } from "@/components/constitution/ConstitutionSubNav";

function ChainStep({
  label,
  detail,
  isLast,
}: {
  label: string;
  detail: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-dim)]">
          <div className="h-2 w-2 rounded-full bg-[var(--color-accent-bright)]" />
        </div>
        {!isLast && (
          <div className="h-8 w-px bg-[var(--color-border)]" />
        )}
      </div>
      <div className="pt-0.5">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-[var(--color-text-muted)]">{detail}</div>
      </div>
    </div>
  );
}

export default function AuthorPage() {
  const preprints = getPreprints();
  const orcid = getAuthorOrcid();

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Author
        </h1>
        <p className="max-w-2xl text-[var(--color-text-secondary)]">
          The constitutional corpus is authored, deposited, and permanently
          linked to its implementation through a verifiable identity chain.
        </p>
        <ConstitutionSubNav active="/constitution/author" />
      </section>

      {/* ORCID card */}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Identity
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30">
            <svg
              width="20"
              height="20"
              viewBox="0 0 256 256"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-emerald-400"
            >
              <path
                d="M128 0C57.3 0 0 57.3 0 128s57.3 128 128 128 128-57.3 128-128S198.7 0 128 0z"
                fill="currentColor"
                opacity="0.2"
              />
              <path
                d="M86.3 186.2H70.9V79.1h15.4v107.1zM108.9 79.1h41.6c39.6 0 57 28.3 57 53.6 0 27.5-21.5 53.6-56.8 53.6h-41.8V79.1zm15.4 93.3h24.5c34.9 0 42.9-26.5 42.9-39.7 0-21.5-13.7-39.7-43.7-39.7h-23.7v79.4z"
                fill="currentColor"
              />
              <circle cx="78.6" cy="62.8" r="8.8" fill="currentColor" />
            </svg>
          </div>
          <div>
            <div className="text-sm text-[var(--color-text-muted)]">ORCID</div>
            <a
              href={`https://orcid.org/${orcid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
            >
              {orcid}
            </a>
          </div>
        </div>
        <div className="rounded-md bg-[var(--color-surface-2)] px-4 py-3">
          <div className="text-xs text-[var(--color-text-muted)]">
            Key Contribution
          </div>
          <div className="mt-1 text-sm font-medium">
            Constitutional Software Engineering
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Building self-governing systems from formal foundations &mdash;
            where every line of code traces to an axiom, every module traces to a
            specification, and every specification traces to peer-reviewed
            literature.
          </p>
        </div>
      </section>

      {/* Preprints */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">
          Preprints
          <span className="ml-2 text-sm font-normal text-[var(--color-text-muted)]">
            {preprints.length} deposited
          </span>
        </h2>
        <div className="space-y-2">
          {preprints.map((p) => (
            <div
              key={p.doi}
              className="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[rgba(255,255,255,0.12)]"
            >
              <div className="text-sm font-medium leading-snug">
                {p.title}
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                <span>{p.date}</span>
                <a
                  href={`https://doi.org/${p.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[var(--color-accent-bright)] transition-colors hover:text-[var(--color-accent)]"
                >
                  doi:{p.doi}
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Identity chain */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Identity Chain</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          The verifiable chain from human identity to executable code.
          Each link is permanent and externally auditable.
        </p>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <ChainStep
            label="ORCID"
            detail={`Persistent researcher identity: ${orcid}`}
          />
          <ChainStep
            label="DOI"
            detail="Zenodo deposits with immutable content hashes"
          />
          <ChainStep
            label="SPEC"
            detail="Formal specifications (SPEC-000 through SPEC-017 + 9 instruments)"
          />
          <ChainStep
            label="Code"
            detail="28 engine modules, each traced to a governing spec"
          />
          <ChainStep
            label="Tests"
            detail="Verification obligations derived from spec invariants"
            isLast
          />
        </div>
      </section>
    </div>
  );
}
