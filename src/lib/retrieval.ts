import type { Repo } from "./types";
import { getManifest } from "./manifest";

const manifest = getManifest();

/** Build Tier 1 context: always-included system summary (~2K tokens). */
export function buildTier1Context(): string {
  const s = manifest.system;
  const organSummary = manifest.organs
    .map(
      (o) =>
        `  ${o.key} (${o.greek}): ${o.name} — ${o.domain} [${o.repo_count} repos]`
    )
    .join("\n");

  const deployments = manifest.deployments
    .map((d) => `  ${d.repo}: ${d.url}`)
    .join("\n");

  return `ORGANVM System Summary
======================
Name: ${s.name} — ${s.tagline}
Total repos: ${s.total_repos} | Active: ${s.active_repos} | Archived: ${s.archived_repos}
Organs: ${s.total_organs}
Sprints completed: ${s.sprints_completed} (since ${s.launch_date})
CI workflows: ${s.ci_workflows}
Dependency edges: ${s.dependency_edges}
Published essays: ${s.published_essays}

Organs:
${organSummary}

Live deployments (${manifest.deployments.length}):
${deployments}

Sprint history: ${s.sprint_names.join(", ")}
`;
}

/** Score repos by keyword relevance to a query. */
function scoreRepo(repo: Repo, terms: string[]): number {
  let score = 0;
  const slugL = repo.slug.toLowerCase();
  const nameL = repo.name.toLowerCase();
  const displayL = repo.display_name.toLowerCase();
  const descL = repo.description.toLowerCase();
  const contextL = repo.ai_context.toLowerCase();
  const sectionsL = Object.values(repo.sections || {}).join(" ").toLowerCase();
  const deploymentsL = repo.deployment_urls.join(" ").toLowerCase();

  for (const term of terms) {
    if (slugL.includes(term)) score += 25;
    if (nameL.includes(term)) score += 20;
    if (displayL.includes(term)) score += 15;
    if (descL.includes(term)) score += 10;
    if (sectionsL.includes(term)) score += 7;
    if (deploymentsL.includes(term)) score += 6;
    if (repo.organ.toLowerCase().includes(term)) score += 8;
    if (repo.tech_stack.some((t) => t.toLowerCase().includes(term))) score += 5;
    if (contextL.includes(term)) score += 2;
  }
  return score;
}

function extractQueryTerms(query: string): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "what",
    "which",
    "show",
    "give",
    "tell",
    "about",
    "from",
    "have",
    "has",
    "that",
    "this",
    "last",
    "repo",
    "repos",
  ]);

  const baseTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stopWords.has(t));

  const expanded = new Set(baseTerms);

  if (baseTerms.includes("omega")) expanded.add("scorecard");
  if (baseTerms.includes("sprint")) expanded.add("sprints");
  if (baseTerms.includes("deploy") || baseTerms.includes("deployed")) {
    expanded.add("deployment");
    expanded.add("deployments");
    expanded.add("https");
  }
  if (baseTerms.includes("tech") || baseTerms.includes("stack")) {
    expanded.add("architecture");
    expanded.add("framework");
    expanded.add("typescript");
    expanded.add("python");
  }

  return [...expanded];
}

/** Build Tier 2 context: query-relevant repo details (~5-15K tokens). */
export function buildTier2Context(query: string): string {
  const terms = extractQueryTerms(query);

  if (terms.length === 0) {
    // Generic query — return top repos by commits
    const top = [...manifest.repos]
      .sort(
        (a, b) =>
          (b.git_stats.total_commits || 0) - (a.git_stats.total_commits || 0)
      )
      .slice(0, 10);
    return formatRepoContexts(top);
  }

  // Check if query mentions a specific organ
  const mentionedOrgan = manifest.organs.find((o) => {
    const qLower = query.toLowerCase();
    return (
      qLower.includes(o.key.toLowerCase()) ||
      qLower.includes(o.name.toLowerCase()) ||
      qLower.includes(o.greek.toLowerCase())
    );
  });

  if (mentionedOrgan) {
    const organRepos = manifest.repos.filter(
      (r) => r.organ === mentionedOrgan.key
    );
    return formatRepoContexts(organRepos);
  }

  // Score and rank repos
  const scored = manifest.repos
    .map((r) => ({ repo: r, score: scoreRepo(r, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Top match gets full sections; rest get ai_context only
  const topMatch = scored[0];
  const rest = scored.slice(1, 15);

  const parts: string[] = [];

  if (topMatch && topMatch.score >= 10) {
    parts.push(formatRepoFull(topMatch.repo));
  }

  if (rest.length > 0) {
    parts.push(
      formatRepoContexts(
        rest.map((s) => s.repo)
      )
    );
  }

  if (parts.length === 0) {
    // Fallback: top 10 repos
    const top = manifest.repos.slice(0, 10);
    return formatRepoContexts(top);
  }

  return parts.join("\n\n");
}

function formatRepoFull(repo: Repo): string {
  const sections = Object.entries(repo.sections)
    .map(([key, val]) => `### ${key}\n${val}`)
    .join("\n\n");

  return `## ${repo.display_name} (${repo.name})
Organ: ${repo.organ} | Tier: ${repo.tier} | Status: ${repo.status} | Promotion: ${repo.promotion_status}
${repo.description}
Tech: ${repo.tech_stack.join(", ") || "N/A"}
GitHub: ${repo.github_url}
Deployments: ${repo.deployment_urls.join(", ") || "None"}
Commits: ${repo.git_stats.total_commits || "N/A"} | Velocity: ${repo.git_stats.weekly_velocity || 0}/wk
Dependencies: ${repo.dependencies.join(", ") || "None"}

${sections}
`;
}

function formatRepoContexts(repos: Repo[]): string {
  return repos
    .map(
      (r) =>
        `- **${r.display_name}** (${r.name}) [${r.organ}/${r.tier}]: ${r.ai_context}`
    )
    .join("\n\n");
}
