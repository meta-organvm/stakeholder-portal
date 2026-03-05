/**
 * Security Layer
 *
 * RBAC/ABAC, data masking for PII, audit logging,
 * and scoped query execution.
 */

// ---------------------------------------------------------------------------
// Role-based access control (RBAC)
// ---------------------------------------------------------------------------

export type Role = "public" | "stakeholder" | "contributor" | "admin";

export interface Permission {
  resource: string;
  actions: Array<"read" | "write" | "delete" | "admin">;
}

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  public: [
    { resource: "repos", actions: ["read"] },
    { resource: "organs", actions: ["read"] },
    { resource: "deployments", actions: ["read"] },
    { resource: "chat", actions: ["read"] },
  ],
  stakeholder: [
    { resource: "repos", actions: ["read"] },
    { resource: "organs", actions: ["read"] },
    { resource: "deployments", actions: ["read"] },
    { resource: "chat", actions: ["read"] },
    { resource: "metrics", actions: ["read"] },
    { resource: "graph", actions: ["read"] },
    { resource: "feedback", actions: ["read", "write"] },
  ],
  contributor: [
    { resource: "repos", actions: ["read", "write"] },
    { resource: "organs", actions: ["read"] },
    { resource: "deployments", actions: ["read"] },
    { resource: "chat", actions: ["read"] },
    { resource: "metrics", actions: ["read"] },
    { resource: "graph", actions: ["read", "write"] },
    { resource: "feedback", actions: ["read", "write"] },
    { resource: "entities", actions: ["read", "write"] },
  ],
  admin: [
    { resource: "*", actions: ["read", "write", "delete", "admin"] },
  ],
};

export function checkPermission(
  role: Role,
  resource: string,
  action: "read" | "write" | "delete" | "admin"
): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;

  return permissions.some((p) => {
    const resourceMatch = p.resource === "*" || p.resource === resource;
    const actionMatch = p.actions.includes(action);
    return resourceMatch && actionMatch;
  });
}

// ---------------------------------------------------------------------------
// Attribute-based access control (ABAC)
// ---------------------------------------------------------------------------

export interface AccessContext {
  role: Role;
  user_id: string | null;
  ip: string | null;
  timestamp: string;
  attributes: Record<string, unknown>;
}

export interface AccessPolicy {
  id: string;
  description: string;
  condition: (ctx: AccessContext) => boolean;
}

const policies: AccessPolicy[] = [];

export function registerPolicy(policy: AccessPolicy): void {
  policies.push(policy);
}

export function evaluateAccess(
  ctx: AccessContext,
  resource: string,
  action: "read" | "write" | "delete" | "admin"
): { allowed: boolean; reason: string } {
  // RBAC check first
  if (!checkPermission(ctx.role, resource, action)) {
    return {
      allowed: false,
      reason: `Role ${ctx.role} lacks ${action} permission on ${resource}`,
    };
  }

  // ABAC policy checks
  for (const policy of policies) {
    if (!policy.condition(ctx)) {
      return {
        allowed: false,
        reason: `Policy ${policy.id} denied: ${policy.description}`,
      };
    }
  }

  return { allowed: true, reason: "Access granted" };
}

// ---------------------------------------------------------------------------
// PII masking
// ---------------------------------------------------------------------------

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL REDACTED]",
  },
  {
    name: "phone",
    pattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    replacement: "[PHONE REDACTED]",
  },
  {
    name: "ssn",
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: "[SSN REDACTED]",
  },
  {
    name: "api_key",
    pattern: /(?:sk|pk|api[_-]?key|token|secret)[_-]?[a-zA-Z0-9_-]{20,}/gi,
    replacement: "[API KEY REDACTED]",
  },
  {
    name: "ip_address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP REDACTED]",
  },
];

export function maskPii(text: string): string {
  let masked = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

export function detectPii(text: string): Array<{ type: string; count: number }> {
  const findings: Array<{ type: string; count: number }> = [];
  for (const { name, pattern } of PII_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      findings.push({ type: name, count: matches.length });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  resource: string;
  user_id: string | null;
  role: Role;
  ip: string | null;
  allowed: boolean;
  reason: string;
  metadata: Record<string, unknown>;
}

const auditLog: AuditEntry[] = [];
let auditCounter = 0;

export function logAudit(
  action: string,
  resource: string,
  ctx: AccessContext,
  allowed: boolean,
  reason: string,
  metadata: Record<string, unknown> = {}
): AuditEntry {
  auditCounter += 1;
  const entry: AuditEntry = {
    id: `audit-${auditCounter}`,
    timestamp: new Date().toISOString(),
    action,
    resource,
    user_id: ctx.user_id,
    role: ctx.role,
    ip: ctx.ip,
    allowed,
    reason,
    metadata,
  };

  auditLog.push(entry);

  // Keep log bounded
  if (auditLog.length > 50_000) {
    auditLog.splice(0, auditLog.length - 50_000);
  }

  return entry;
}

export function getAuditLog(limit = 100): AuditEntry[] {
  return auditLog.slice(-limit).reverse();
}

export function getAuditStats(): {
  total: number;
  allowed: number;
  denied: number;
  by_action: Record<string, number>;
} {
  const byAction: Record<string, number> = {};
  let allowed = 0;
  let denied = 0;

  for (const entry of auditLog) {
    byAction[entry.action] = (byAction[entry.action] || 0) + 1;
    if (entry.allowed) allowed++;
    else denied++;
  }

  return {
    total: auditLog.length,
    allowed,
    denied,
    by_action: byAction,
  };
}

export function resetAuditLog(): void {
  auditLog.length = 0;
  auditCounter = 0;
}

// ---------------------------------------------------------------------------
// Request context builder
// ---------------------------------------------------------------------------

export function buildAccessContext(
  request: Request,
  role: Role = "public"
): AccessContext {
  return {
    role,
    user_id: null,
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    timestamp: new Date().toISOString(),
    attributes: {
      user_agent: request.headers.get("user-agent") ?? "",
      origin: request.headers.get("origin") ?? "",
    },
  };
}
