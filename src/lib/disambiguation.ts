/**
 * Entity Disambiguation
 *
 * Confidence-scored disambiguation for entity resolution.
 * Detects potential duplicates, scores similarity, and manages
 * a review queue for ambiguous cases.
 */

import type { Entity } from "./ontology";
import { getEntityRegistry } from "./entity-registry";

// ---------------------------------------------------------------------------
// Disambiguation types
// ---------------------------------------------------------------------------

export interface DisambiguationCandidate {
  entity_a: string;      // entity ID
  entity_b: string;      // entity ID
  similarity: number;    // 0.0 – 1.0
  signals: string[];     // what matched
  recommendation: "merge" | "keep_separate" | "needs_review";
}

export interface DisambiguationConfig {
  /** Auto-merge threshold. Above this → auto merge. */
  merge_threshold: number;
  /** Review threshold. Between this and merge → human review. */
  review_threshold: number;
  /** Below review threshold → keep separate. */
}

const DEFAULT_CONFIG: DisambiguationConfig = {
  merge_threshold: 0.9,
  review_threshold: 0.6,
};

// ---------------------------------------------------------------------------
// String similarity (Jaccard on character bigrams)
// ---------------------------------------------------------------------------

function bigrams(str: string): Set<string> {
  const s = str.toLowerCase().trim();
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;

  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Entity similarity scoring
// ---------------------------------------------------------------------------

export function computeSimilarity(a: Entity, b: Entity): {
  score: number;
  signals: string[];
} {
  const signals: string[] = [];
  let totalWeight = 0;
  let weightedScore = 0;

  // Same entity class?
  if (a.entity_class === b.entity_class) {
    signals.push("same_class");
    weightedScore += 0.2;
  }
  totalWeight += 0.2;

  // Name similarity
  const nameSim = jaccardSimilarity(a.name, b.name);
  if (nameSim > 0.7) signals.push(`name_sim=${nameSim.toFixed(2)}`);
  weightedScore += nameSim * 0.35;
  totalWeight += 0.35;

  // Display name similarity
  const displaySim = jaccardSimilarity(a.display_name, b.display_name);
  if (displaySim > 0.7) signals.push(`display_sim=${displaySim.toFixed(2)}`);
  weightedScore += displaySim * 0.2;
  totalWeight += 0.2;

  // Description similarity
  const descSim = jaccardSimilarity(
    a.description.slice(0, 200),
    b.description.slice(0, 200)
  );
  if (descSim > 0.5) signals.push(`desc_sim=${descSim.toFixed(2)}`);
  weightedScore += descSim * 0.15;
  totalWeight += 0.15;

  // Source overlap
  if (a.envelope.source_type === b.envelope.source_type) {
    signals.push("same_source");
    weightedScore += 0.1;
  }
  totalWeight += 0.1;

  return {
    score: totalWeight > 0 ? weightedScore / totalWeight : 0,
    signals,
  };
}

// ---------------------------------------------------------------------------
// Disambiguation engine
// ---------------------------------------------------------------------------

export function findDuplicates(
  config: DisambiguationConfig = DEFAULT_CONFIG
): DisambiguationCandidate[] {
  const registry = getEntityRegistry();
  const entities = registry.list();
  const candidates: DisambiguationCandidate[] = [];

  // Compare all pairs within same entity class
  const byClass = new Map<string, Entity[]>();
  for (const e of entities) {
    const list = byClass.get(e.entity_class) || [];
    list.push(e);
    byClass.set(e.entity_class, list);
  }

  for (const [, classEntities] of byClass) {
    for (let i = 0; i < classEntities.length; i++) {
      for (let j = i + 1; j < classEntities.length; j++) {
        const { score, signals } = computeSimilarity(classEntities[i], classEntities[j]);

        if (score < config.review_threshold) continue;

        let recommendation: "merge" | "keep_separate" | "needs_review";
        if (score >= config.merge_threshold) {
          recommendation = "merge";
        } else if (score >= config.review_threshold) {
          recommendation = "needs_review";
        } else {
          recommendation = "keep_separate";
        }

        candidates.push({
          entity_a: classEntities[i].id,
          entity_b: classEntities[j].id,
          similarity: score,
          signals,
          recommendation,
        });
      }
    }
  }

  return candidates.sort((a, b) => b.similarity - a.similarity);
}

/** Auto-resolve duplicates above the merge threshold. */
export function autoResolve(
  config: DisambiguationConfig = DEFAULT_CONFIG
): { merged: number; queued: number } {
  const candidates = findDuplicates(config);
  const registry = getEntityRegistry();
  let merged = 0;
  let queued = 0;

  for (const candidate of candidates) {
    if (candidate.recommendation === "merge") {
      const success = registry.merge(
        [candidate.entity_a, candidate.entity_b],
        candidate.entity_a, // prefer first by ID sort
        `Auto-merge: similarity=${candidate.similarity.toFixed(2)}, signals=${candidate.signals.join(",")}`
      );
      if (success) merged++;
    } else if (candidate.recommendation === "needs_review") {
      registry.flagForReview(
        candidate.entity_a,
        `Potential duplicate of ${candidate.entity_b} (similarity=${candidate.similarity.toFixed(2)})`
      );
      queued++;
    }
  }

  return { merged, queued };
}
