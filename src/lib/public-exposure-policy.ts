const NONPUBLIC_REPO_NAMES = new Set([
  "my-knowledge-base",
  "nexus--babel-alexandria-",
]);

const PUBLIC_SECTION_KEYS = new Set([
  "what this is",
  "architecture",
  "features",
  "remaining limitations",
  "schemas",
]);

const NONPUBLIC_FACETS_ENABLED = process.env.NONPUBLIC_FACETS_ENABLED === "true";

export interface PublicRepoCandidate {
  name: string;
  public?: boolean;
}

export interface PrismFacet {
  id: string;
  name: string;
  role: string;
  url: string | null;
  live: boolean;
}

export function shouldIncludeRepoInPublicManifest(repo: PublicRepoCandidate): boolean {
  if (repo.public !== true) {
    return false;
  }

  if (!NONPUBLIC_FACETS_ENABLED && NONPUBLIC_REPO_NAMES.has(repo.name)) {
    return false;
  }

  return true;
}

export function sanitizeRepoSectionsForPublicManifest(
  sections: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sections).filter(([key]) => PUBLIC_SECTION_KEYS.has(key)),
  );
}

export function isNonPublicFacetExposureEnabled(): boolean {
  return NONPUBLIC_FACETS_ENABLED;
}

export function getPrismFacets(): PrismFacet[] {
  return [
    {
      id: "portfolio",
      name: "Portfolio",
      role: "face",
      url: "https://4444j99.github.io/portfolio",
      live: true,
    },
    {
      id: "hermeneus",
      name: "Hermeneus",
      role: "intelligence",
      url: "https://stakeholder-portal-ten.vercel.app",
      live: true,
    },
    {
      id: "knowledge-base",
      name: "Knowledge Base",
      role: "memory",
      url: NONPUBLIC_FACETS_ENABLED
        ? "https://organvm-i-theoria.github.io/my-knowledge-base"
        : null,
      live: NONPUBLIC_FACETS_ENABLED,
    },
    {
      id: "nexus",
      name: "Nexus Babel Alexandria",
      role: "laboratory",
      url: null,
      live: false,
    },
  ];
}
