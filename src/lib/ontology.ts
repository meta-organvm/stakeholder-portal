/**
 * ORGANVM Domain Ontology v1
 *
 * Defines the entity classes, relationship types, and attribute schemas
 * for the stakeholder intelligence knowledge graph.
 *
 * Schema version: 1.0.0
 * Migration path: additive-only until v2.
 */

export const ONTOLOGY_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Entity class enum
// ---------------------------------------------------------------------------

export type EntityClass =
  | "organ"
  | "repo"
  | "artifact"
  | "decision"
  | "persona"
  | "deployment"
  | "dependency"
  | "sprint"
  | "issue"
  | "conversation";

export const ENTITY_CLASSES: readonly EntityClass[] = [
  "organ",
  "repo",
  "artifact",
  "decision",
  "persona",
  "deployment",
  "dependency",
  "sprint",
  "issue",
  "conversation",
] as const;

// ---------------------------------------------------------------------------
// Relationship types
// ---------------------------------------------------------------------------

export type RelationshipType =
  | "belongs_to"       // repo → organ
  | "depends_on"       // repo → repo
  | "produces"         // repo → artifact
  | "consumes"         // repo → artifact
  | "deploys_to"       // repo → deployment
  | "authored_by"      // artifact → persona
  | "decided_by"       // decision → persona
  | "impacts"          // decision → repo/organ
  | "assigned_to"      // issue → persona
  | "references"       // conversation → repo/artifact
  | "part_of"          // sprint → organ
  | "blocked_by"       // issue → issue
  | "successor_of"     // decision → decision
  | "owns"             // persona → repo
  | "contributes_to";  // persona → repo

export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  "belongs_to",
  "depends_on",
  "produces",
  "consumes",
  "deploys_to",
  "authored_by",
  "decided_by",
  "impacts",
  "assigned_to",
  "references",
  "part_of",
  "blocked_by",
  "successor_of",
  "owns",
  "contributes_to",
] as const;

// ---------------------------------------------------------------------------
// Context envelope — attached to every ingested record
// ---------------------------------------------------------------------------

export interface ContextEnvelope {
  source_id: string;         // connector/source identifier
  source_type: string;       // "github" | "workspace" | "manual" | etc.
  ingested_at: string;       // ISO 8601
  valid_from: string;        // temporal window start
  valid_until: string | null; // null = still current
  actor: string | null;      // who/what generated this data
  channel: string | null;    // "api" | "webhook" | "crawl" | "manual"
  environment: string;       // "production" | "staging" | "local"
  confidence: number;        // 0.0 – 1.0
}

export function createEnvelope(
  partial: Partial<ContextEnvelope> & Pick<ContextEnvelope, "source_id" | "source_type">
): ContextEnvelope {
  const now = new Date().toISOString();
  return {
    ingested_at: now,
    valid_from: now,
    valid_until: null,
    actor: null,
    channel: null,
    environment: "production",
    confidence: 1.0,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Entity base
// ---------------------------------------------------------------------------

export interface Entity {
  id: string;                     // canonical ID (e.g., "repo:organvm-engine")
  entity_class: EntityClass;
  name: string;
  display_name: string;
  description: string;
  attributes: Record<string, unknown>;
  envelope: ContextEnvelope;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Typed entity attribute schemas (per entity class)
// ---------------------------------------------------------------------------

export interface OrganAttributes {
  key: string;
  greek: string;
  domain: string;
  org: string;
  repo_count: number;
  status: string;
  palette: string;
  typography: string;
  tone: string;
}

export interface RepoAttributes {
  organ_key: string;
  org: string;
  tier: string;
  status: string;
  promotion_status: string;
  tech_stack: string[];
  ci_workflow: string | null;
  dependencies: string[];
  produces: string[];
  consumes: string[];
  deployment_urls: string[];
  github_url: string;
  total_commits: number;
  weekly_velocity: number;
  revenue_model: string | null;
  platinum_status: boolean;
}

export interface ArtifactAttributes {
  artifact_type: string;   // "code" | "doc" | "config" | "schema" | "dataset"
  path: string;
  format: string;
  size_bytes: number | null;
  version: string | null;
}

export interface DecisionAttributes {
  decision_type: string;   // "architectural" | "governance" | "promotion" | "deprecation"
  status: string;          // "proposed" | "accepted" | "superseded" | "rejected"
  rationale: string;
  affected_repos: string[];
}

export interface PersonaAttributes {
  role: string;            // "maintainer" | "contributor" | "stakeholder" | "system"
  email: string | null;
  github_handle: string | null;
}

export interface DeploymentAttributes {
  url: string;
  platform: string;        // "vercel" | "netlify" | "cloudflare" | "custom"
  status: string;          // "live" | "staging" | "down"
  last_deploy: string | null;
}

export interface DependencyAttributes {
  dependency_type: string;  // "runtime" | "dev" | "peer" | "data"
  version_constraint: string | null;
  is_direct: boolean;
}

export interface SprintAttributes {
  sprint_number: number;
  start_date: string;
  end_date: string | null;
  status: string;           // "active" | "completed" | "planned"
  goals: string[];
}

export interface IssueAttributes {
  issue_type: string;        // "bug" | "feature" | "task" | "epic"
  priority: string;          // "critical" | "high" | "medium" | "low"
  state: string;             // "open" | "closed" | "in_progress"
  labels: string[];
  source_url: string | null;
}

export interface ConversationAttributes {
  channel: string;           // "chat" | "issue" | "pr" | "discussion" | "slack"
  participant_count: number;
  message_count: number;
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// Relationship edge
// ---------------------------------------------------------------------------

export interface Relationship {
  id: string;
  type: RelationshipType;
  source_id: string;          // entity ID
  target_id: string;          // entity ID
  strength: number;           // 0.0 – 1.0
  direction: "forward" | "bidirectional";
  evidence: string[];         // provenance strings
  envelope: ContextEnvelope;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

const VALID_SOURCE_ENTITIES: Record<RelationshipType, EntityClass[]> = {
  belongs_to: ["repo"],
  depends_on: ["repo"],
  produces: ["repo"],
  consumes: ["repo"],
  deploys_to: ["repo"],
  authored_by: ["artifact"],
  decided_by: ["decision"],
  impacts: ["decision"],
  assigned_to: ["issue"],
  references: ["conversation"],
  part_of: ["sprint"],
  blocked_by: ["issue"],
  successor_of: ["decision"],
  owns: ["persona"],
  contributes_to: ["persona"],
};

const VALID_TARGET_ENTITIES: Record<RelationshipType, EntityClass[]> = {
  belongs_to: ["organ"],
  depends_on: ["repo"],
  produces: ["artifact"],
  consumes: ["artifact"],
  deploys_to: ["deployment"],
  authored_by: ["persona"],
  decided_by: ["persona"],
  impacts: ["repo", "organ"],
  assigned_to: ["persona"],
  references: ["repo", "artifact"],
  part_of: ["organ"],
  blocked_by: ["issue"],
  successor_of: ["decision"],
  owns: ["repo"],
  contributes_to: ["repo"],
};

export function validateRelationship(
  rel: RelationshipType,
  sourceClass: EntityClass,
  targetClass: EntityClass
): { valid: boolean; reason?: string } {
  const validSources = VALID_SOURCE_ENTITIES[rel];
  const validTargets = VALID_TARGET_ENTITIES[rel];

  if (!validSources.includes(sourceClass)) {
    return {
      valid: false,
      reason: `${rel}: source must be ${validSources.join("|")}, got ${sourceClass}`,
    };
  }
  if (!validTargets.includes(targetClass)) {
    return {
      valid: false,
      reason: `${rel}: target must be ${validTargets.join("|")}, got ${targetClass}`,
    };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Entity ID helpers
// ---------------------------------------------------------------------------

export function makeEntityId(entityClass: EntityClass, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${entityClass}:${slug}`;
}

export function parseEntityId(id: string): { entityClass: EntityClass; slug: string } | null {
  const colonIdx = id.indexOf(":");
  if (colonIdx < 0) return null;
  const cls = id.slice(0, colonIdx) as EntityClass;
  if (!ENTITY_CLASSES.includes(cls)) return null;
  return { entityClass: cls, slug: id.slice(colonIdx + 1) };
}
