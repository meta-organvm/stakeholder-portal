/**
 * Inference Rule Engine
 *
 * Derives new relationships from existing graph data.
 * Rules like "repo with deployment URL → deploys_to deployment entity",
 * "decision impacts organ if decision.affected_repos overlap organ repos".
 *
 * Tracks precision/recall for rule evaluation.
 */

import type { Entity, RelationshipType } from "./ontology";
import { createEnvelope, makeEntityId } from "./ontology";
import { getKnowledgeGraph } from "./graph";
import { getEntityRegistry, createEntity } from "./entity-registry";

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

export interface InferenceRule {
  id: string;
  name: string;
  description: string;
  /** Which entity classes this rule applies to. */
  applies_to: string[];
  /** The rule function: receives an entity, returns derived relationships. */
  apply: (entity: Entity) => DerivedRelationship[];
}

export interface DerivedRelationship {
  type: RelationshipType;
  source_id: string;
  target_id: string;
  strength: number;
  evidence: string;
}

export interface RuleMetrics {
  rule_id: string;
  total_applied: number;
  relationships_created: number;
  last_run: string | null;
}

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

const rules: InferenceRule[] = [];
const metrics = new Map<string, RuleMetrics>();

/** Register a new inference rule. */
export function registerRule(rule: InferenceRule): void {
  rules.push(rule);
  metrics.set(rule.id, {
    rule_id: rule.id,
    total_applied: 0,
    relationships_created: 0,
    last_run: null,
  });
}

/** Get all registered rules. */
export function listRules(): InferenceRule[] {
  return [...rules];
}

/** Get metrics for all rules. */
export function getRuleMetrics(): RuleMetrics[] {
  return [...metrics.values()];
}

// ---------------------------------------------------------------------------
// Built-in rule: repo with deployment URLs → deploys_to
// ---------------------------------------------------------------------------

registerRule({
  id: "repo-deployment",
  name: "Repo Deploys To",
  description: "Creates deploys_to edges for repos with deployment URLs",
  applies_to: ["repo"],
  apply: (entity: Entity): DerivedRelationship[] => {
    const urls = entity.attributes.deployment_urls;
    if (!Array.isArray(urls) || urls.length === 0) return [];

    const results: DerivedRelationship[] = [];
    for (const url of urls) {
      if (typeof url !== "string") continue;
      const deploymentId = makeEntityId("deployment", url);

      // Create deployment entity if it doesn't exist
      const registry = getEntityRegistry();
      if (!registry.has(deploymentId)) {
        const platform = detectPlatform(url);
        const deployEntity = createEntity("deployment", url, `Deployment at ${url}`, {
          url,
          platform,
          status: "live",
          last_deploy: null,
        });
        deployEntity.id = deploymentId;
        registry.register(deployEntity);
        getKnowledgeGraph().addNode(deployEntity);
      }

      results.push({
        type: "deploys_to",
        source_id: entity.id,
        target_id: deploymentId,
        strength: 0.95,
        evidence: `Deployment URL: ${url}`,
      });
    }

    return results;
  },
});

// ---------------------------------------------------------------------------
// Built-in rule: repo belongs_to organ (from organ_key attribute)
// ---------------------------------------------------------------------------

registerRule({
  id: "repo-organ-membership",
  name: "Repo Belongs To Organ",
  description: "Creates belongs_to edges from repo.organ_key to organ entities",
  applies_to: ["repo"],
  apply: (entity: Entity): DerivedRelationship[] => {
    const organKey = entity.attributes.organ_key ?? entity.attributes.organ_dir;
    if (typeof organKey !== "string") return [];

    const organId = makeEntityId("organ", organKey);

    return [
      {
        type: "belongs_to",
        source_id: entity.id,
        target_id: organId,
        strength: 1.0,
        evidence: `Organ membership: ${organKey}`,
      },
    ];
  },
});

// ---------------------------------------------------------------------------
// Built-in rule: repo depends_on from dependencies list
// ---------------------------------------------------------------------------

registerRule({
  id: "repo-dependencies",
  name: "Repo Dependencies",
  description: "Creates depends_on edges from repo.dependencies list",
  applies_to: ["repo"],
  apply: (entity: Entity): DerivedRelationship[] => {
    const deps = entity.attributes.dependencies;
    if (!Array.isArray(deps)) return [];

    return deps
      .filter((d): d is string => typeof d === "string" && d.length > 0)
      .map((dep) => ({
        type: "depends_on" as RelationshipType,
        source_id: entity.id,
        target_id: makeEntityId("repo", dep),
        strength: 0.9,
        evidence: `Dependency: ${dep}`,
      }));
  },
});

// ---------------------------------------------------------------------------
// Built-in rule: decision impacts repos
// ---------------------------------------------------------------------------

registerRule({
  id: "decision-impact",
  name: "Decision Impacts Repos",
  description: "Creates impacts edges from decision.affected_repos to repo entities",
  applies_to: ["decision"],
  apply: (entity: Entity): DerivedRelationship[] => {
    const affected = entity.attributes.affected_repos;
    if (!Array.isArray(affected)) return [];

    return affected
      .filter((r): r is string => typeof r === "string")
      .map((repo) => ({
        type: "impacts" as RelationshipType,
        source_id: entity.id,
        target_id: makeEntityId("repo", repo),
        strength: 0.85,
        evidence: `Decision affects repo: ${repo}`,
      }));
  },
});

// ---------------------------------------------------------------------------
// Built-in rule: project health inference
// ---------------------------------------------------------------------------

registerRule({
  id: "project-health",
  name: "Project Health Inference",
  description: "Calculates health scores based on commit activity and issue density",
  applies_to: ["repo"],
  apply: (entity: Entity): DerivedRelationship[] => {
    const commits = Number(entity.attributes.total_commits ?? 0);
    const issues = Number(entity.attributes.open_issues ?? 0);
    const lastPushed = entity.attributes.pushed_at ?? entity.attributes.last_commit;

    if (!commits && !issues && !lastPushed) return [];

    let score = 0.5; // Baseline

    // Activity bonus
    if (lastPushed) {
      const pushedAtMs = Date.parse(String(lastPushed));
      if (Number.isFinite(pushedAtMs)) {
        const daysSince =
          (Date.now() - pushedAtMs) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) score += 0.3;
        else if (daysSince < 30) score += 0.1;
        else score -= 0.2;
      }
    }

    // Complexity/Stability ratio
    if (commits > 0) {
      const issueDensity = issues / commits;
      if (issueDensity < 0.05) score += 0.2; // Very stable
      else if (issueDensity > 0.5) score -= 0.3; // High technical debt/churn
    }

    const finalScore = Math.max(0, Math.min(1, score));

    // Update entity attributes with the derived health score
    entity.attributes.health_score = finalScore;
    entity.attributes.health_label =
      finalScore > 0.8 ? "robust" : finalScore > 0.4 ? "active" : "stagnant";

    return []; // No new edges, just enrichment for now
  },
});

// ---------------------------------------------------------------------------
// Engine execution
// ---------------------------------------------------------------------------

/** Run all inference rules on all applicable entities. Returns count of derived edges. */
export function runInference(): number {
  const graph = getKnowledgeGraph();
  let totalCreated = 0;

  for (const rule of rules) {
    const m = metrics.get(rule.id)!;
    let ruleCreated = 0;

    for (const entityClass of rule.applies_to) {
      const entities = graph.listNodes(entityClass as Entity["entity_class"]);
      m.total_applied += entities.length;

      for (const entity of entities) {
        const derived = rule.apply(entity);

        for (const rel of derived) {
          // Skip if edge already exists
          const edgeId = `inferred:${rel.source_id}-${rel.type}-${rel.target_id}`;
          if (graph.getEdge(edgeId)) continue;

          graph.addEdge({
            id: edgeId,
            type: rel.type,
            source_id: rel.source_id,
            target_id: rel.target_id,
            strength: rel.strength,
            direction: "forward",
            evidence: [rel.evidence, `rule:${rule.id}`],
            envelope: createEnvelope({
              source_id: `inference:${rule.id}`,
              source_type: "inference",
              channel: "rule-engine",
              confidence: rel.strength,
            }),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          ruleCreated++;
        }
      }
    }

    m.relationships_created += ruleCreated;
    m.last_run = new Date().toISOString();
    totalCreated += ruleCreated;
  }

  return totalCreated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectPlatform(url: string): string {
  try {
    const { hostname } = new URL(url);
    if (hostname === "vercel.app" || hostname.endsWith(".vercel.app") ||
        hostname === "vercel.com" || hostname.endsWith(".vercel.com")) return "vercel";
    if (hostname === "netlify.app" || hostname.endsWith(".netlify.app") ||
        hostname === "netlify.com" || hostname.endsWith(".netlify.com")) return "netlify";
    if (hostname === "pages.dev" || hostname.endsWith(".pages.dev") ||
        hostname.endsWith(".cloudflare.com")) return "cloudflare";
    if (hostname.endsWith(".github.io")) return "github-pages";
  } catch {
    // Malformed URL — fall through to custom
  }
  return "custom";
}
