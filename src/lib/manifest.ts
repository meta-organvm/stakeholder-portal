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

/** Structured organ data for external API consumers (consult page, etc.) */
export function getOrgansForAPI() {
  return manifest.organs.map((organ) => {
    const repos = manifest.repos.filter((r) => r.organ === organ.key);
    const techStacks = new Set<string>();
    for (const r of repos) {
      for (const t of r.tech_stack.slice(0, 5)) techStacks.add(t);
    }
    return {
      key: organ.key,
      name: organ.name,
      greek: organ.greek,
      domain: organ.domain,
      description: organ.description,
      repo_count: organ.repo_count,
      status: organ.status,
      capabilities: repos
        .filter((r) => r.tier === "flagship" || r.description.length > 30)
        .slice(0, 5)
        .map((r) => `${r.display_name}: ${r.description.slice(0, 150)}`),
      repos: repos.map((r) => ({
        name: r.name,
        display_name: r.display_name,
        tier: r.tier,
        description: r.description.slice(0, 200),
        tech_stack: r.tech_stack.slice(0, 5),
        deployment_urls: r.deployment_urls,
      })),
      tech_stacks: [...techStacks].slice(0, 15),
    };
  });
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
