import type { Manifest, Organ, Repo, Deployment } from "./types";
import { parseManifest } from "@/validation/manifest";
import manifestData from "../data/manifest.json";

const manifest: Manifest = parseManifest(manifestData);

export function getManifest(): Manifest {
  return manifest;
}

export function getSystem() {
  return manifest.system;
}

export function getOrgans(): Organ[] {
  return manifest.organs;
}

export function getOrgan(key: string): Organ | undefined {
  return manifest.organs.find((o) => o.key === key);
}

export function getRepos(): Repo[] {
  return manifest.repos;
}

export function getRepo(slug: string): Repo | undefined {
  return manifest.repos.find((r) => r.slug === slug);
}

export function getReposByOrgan(organKey: string): Repo[] {
  return manifest.repos.filter((r) => r.organ === organKey);
}

export function getDeployments(): Deployment[] {
  return manifest.deployments;
}

export function getDependencyGraph() {
  return manifest.dependency_graph;
}

export function getMetrics() {
  const s = manifest.system;
  return {
    repos: s.total_repos,
    organs: s.total_organs,
    sprints: s.sprints_completed,
    ciWorkflows: s.ci_workflows,
    deployments: manifest.deployments.length,
    essays: s.published_essays,
    depEdges: s.dependency_edges,
    activeRepos: s.active_repos,
  };
}

/** Simple keyword search across repos. Returns scored results. */
export function searchRepos(
  query: string,
  filters?: {
    organ?: string;
    tier?: string;
    status?: string;
    promotion_status?: string;
  }
): Repo[] {
  let results = manifest.repos;

  if (filters?.organ) {
    results = results.filter((r) => r.organ === filters.organ);
  }
  if (filters?.tier) {
    results = results.filter((r) => r.tier === filters.tier);
  }
  if (filters?.status) {
    results = results.filter((r) => r.status === filters.status);
  }
  if (filters?.promotion_status) {
    results = results.filter(
      (r) => r.promotion_status === filters.promotion_status
    );
  }

  if (!query.trim()) return results;

  const terms = query.toLowerCase().split(/\s+/);

  const scored = results.map((repo) => {
    const haystack = [
      repo.name,
      repo.display_name,
      repo.description,
      repo.organ,
      ...repo.tech_stack,
      repo.ai_context,
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (repo.name.toLowerCase().includes(term)) score += 10;
      if (repo.display_name.toLowerCase().includes(term)) score += 8;
      if (repo.description.toLowerCase().includes(term)) score += 5;
      if (haystack.includes(term)) score += 1;
    }
    return { repo, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.repo);
}
