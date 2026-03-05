/**
 * Knowledge Graph
 *
 * In-memory graph with typed nodes, edges, temporal validity windows,
 * and traversal APIs. Designed for future Neo4j swap-in.
 */

import type { Entity, Relationship, EntityClass, RelationshipType } from "./ontology";

// ---------------------------------------------------------------------------
// Graph query types
// ---------------------------------------------------------------------------

export interface TraversalResult {
  path: string[];      // entity IDs in traversal order
  edges: Relationship[];
  depth: number;
}

export interface NeighborResult {
  entity: Entity;
  relationship: Relationship;
  direction: "outgoing" | "incoming";
}

export interface SubgraphResult {
  nodes: Entity[];
  edges: Relationship[];
}

// ---------------------------------------------------------------------------
// Knowledge Graph
// ---------------------------------------------------------------------------

export class KnowledgeGraph {
  private nodes = new Map<string, Entity>();
  private edges = new Map<string, Relationship>();
  private outgoing = new Map<string, Set<string>>();   // node ID → edge IDs
  private incoming = new Map<string, Set<string>>();   // node ID → edge IDs

  // -----------------------------------------------------------------------
  // Node operations
  // -----------------------------------------------------------------------

  addNode(entity: Entity): void {
    this.nodes.set(entity.id, entity);
    if (!this.outgoing.has(entity.id)) this.outgoing.set(entity.id, new Set());
    if (!this.incoming.has(entity.id)) this.incoming.set(entity.id, new Set());
  }

  getNode(id: string): Entity | undefined {
    return this.nodes.get(id);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  removeNode(id: string): void {
    // Remove all edges connected to this node
    const out = this.outgoing.get(id) || new Set();
    const inc = this.incoming.get(id) || new Set();
    for (const edgeId of [...out, ...inc]) {
      this.removeEdge(edgeId);
    }
    this.nodes.delete(id);
    this.outgoing.delete(id);
    this.incoming.delete(id);
  }

  listNodes(entityClass?: EntityClass): Entity[] {
    const all = [...this.nodes.values()];
    if (!entityClass) return all;
    return all.filter((n) => n.entity_class === entityClass);
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  // -----------------------------------------------------------------------
  // Edge operations
  // -----------------------------------------------------------------------

  addEdge(relationship: Relationship): void {
    this.edges.set(relationship.id, relationship);

    // Ensure adjacency sets exist even for dangling references
    if (!this.outgoing.has(relationship.source_id)) {
      this.outgoing.set(relationship.source_id, new Set());
    }
    if (!this.incoming.has(relationship.target_id)) {
      this.incoming.set(relationship.target_id, new Set());
    }

    this.outgoing.get(relationship.source_id)!.add(relationship.id);
    this.incoming.get(relationship.target_id)!.add(relationship.id);
  }

  getEdge(id: string): Relationship | undefined {
    return this.edges.get(id);
  }

  removeEdge(id: string): void {
    const edge = this.edges.get(id);
    if (!edge) return;
    this.outgoing.get(edge.source_id)?.delete(id);
    this.incoming.get(edge.target_id)?.delete(id);
    this.edges.delete(id);
  }

  listEdges(type?: RelationshipType): Relationship[] {
    const all = [...this.edges.values()];
    if (!type) return all;
    return all.filter((e) => e.type === type);
  }

  edgeCount(): number {
    return this.edges.size;
  }

  // -----------------------------------------------------------------------
  // Traversal APIs
  // -----------------------------------------------------------------------

  /** Get immediate neighbors of a node. */
  neighbors(
    nodeId: string,
    direction: "outgoing" | "incoming" | "both" = "both",
    relType?: RelationshipType
  ): NeighborResult[] {
    const results: NeighborResult[] = [];

    if (direction === "outgoing" || direction === "both") {
      const edgeIds = this.outgoing.get(nodeId) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (relType && edge.type !== relType) continue;
        const entity = this.nodes.get(edge.target_id);
        if (entity) {
          results.push({ entity, relationship: edge, direction: "outgoing" });
        }
      }
    }

    if (direction === "incoming" || direction === "both") {
      const edgeIds = this.incoming.get(nodeId) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (relType && edge.type !== relType) continue;
        const entity = this.nodes.get(edge.source_id);
        if (entity) {
          results.push({ entity, relationship: edge, direction: "incoming" });
        }
      }
    }

    return results;
  }

  /** BFS traversal from a starting node, up to maxDepth. */
  traverse(
    startId: string,
    maxDepth = 3,
    relTypes?: RelationshipType[]
  ): TraversalResult[] {
    const results: TraversalResult[] = [];
    const visited = new Set<string>();

    interface QueueItem {
      nodeId: string;
      path: string[];
      edges: Relationship[];
      depth: number;
    }

    const queue: QueueItem[] = [{ nodeId: startId, path: [startId], edges: [], depth: 0 }];
    visited.add(startId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > 0) {
        results.push({
          path: current.path,
          edges: current.edges,
          depth: current.depth,
        });
      }

      if (current.depth >= maxDepth) continue;

      const edgeIds = this.outgoing.get(current.nodeId) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (relTypes && !relTypes.includes(edge.type)) continue;
        if (visited.has(edge.target_id)) continue;

        visited.add(edge.target_id);
        queue.push({
          nodeId: edge.target_id,
          path: [...current.path, edge.target_id],
          edges: [...current.edges, edge],
          depth: current.depth + 1,
        });
      }
    }

    return results;
  }

  /** Extract a subgraph centered on a node within a given depth. */
  subgraph(centerId: string, depth = 2): SubgraphResult {
    const nodeIds = new Set<string>();
    const edgeSet = new Set<string>();

    const traversals = this.traverse(centerId, depth);
    nodeIds.add(centerId);

    for (const t of traversals) {
      for (const id of t.path) nodeIds.add(id);
      for (const e of t.edges) edgeSet.add(e.id);
    }

    // Also include incoming edges
    for (const nodeId of nodeIds) {
      const inc = this.incoming.get(nodeId) || new Set();
      for (const edgeId of inc) {
        const edge = this.edges.get(edgeId);
        if (edge && nodeIds.has(edge.source_id)) {
          edgeSet.add(edgeId);
        }
      }
    }

    return {
      nodes: [...nodeIds].map((id) => this.nodes.get(id)!).filter(Boolean),
      edges: [...edgeSet].map((id) => this.edges.get(id)!).filter(Boolean),
    };
  }

  /** Find shortest path between two nodes (BFS). */
  shortestPath(fromId: string, toId: string, maxDepth = 10): string[] | null {
    if (fromId === toId) return [fromId];
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: string[] }> = [
      { nodeId: fromId, path: [fromId] },
    ];
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length > maxDepth) continue;

      const edgeIds = this.outgoing.get(current.nodeId) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (edge.target_id === toId) {
          return [...current.path, toId];
        }
        if (!visited.has(edge.target_id)) {
          visited.add(edge.target_id);
          queue.push({
            nodeId: edge.target_id,
            path: [...current.path, edge.target_id],
          });
        }
      }
    }

    return null;
  }

  /** Get all nodes reachable from a set of root nodes by relationship type. */
  reachable(rootIds: string[], relType?: RelationshipType): Entity[] {
    const visited = new Set<string>();
    const queue = [...rootIds];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const edgeIds = this.outgoing.get(nodeId) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (relType && edge.type !== relType) continue;
        if (!visited.has(edge.target_id)) {
          queue.push(edge.target_id);
        }
      }
    }

    return [...visited]
      .map((id) => this.nodes.get(id))
      .filter((n): n is Entity => n !== undefined);
  }

  /** Compute graph statistics. */
  stats(): {
    nodes: number;
    edges: number;
    nodesByClass: Record<string, number>;
    edgesByType: Record<string, number>;
  } {
    const nodesByClass: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      nodesByClass[node.entity_class] = (nodesByClass[node.entity_class] || 0) + 1;
    }

    const edgesByType: Record<string, number> = {};
    for (const edge of this.edges.values()) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }

    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      nodesByClass,
      edgesByType,
    };
  }

  /** Clear all data. */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.outgoing.clear();
    this.incoming.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: KnowledgeGraph | null = null;

export function getKnowledgeGraph(): KnowledgeGraph {
  if (!_instance) {
    _instance = new KnowledgeGraph();
  }
  return _instance;
}

export function resetKnowledgeGraph(): void {
  _instance = null;
}
