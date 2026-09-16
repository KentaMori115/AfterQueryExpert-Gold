/**
 * Small directed graph helpers.
 *
 * Two things in a show form a graph. Script files include other script files,
 * and a cue group can reference another group so a chorus can be reused
 * verbatim in three places. Both need the same answers, which are whether
 * there is a cycle, what order to process in, and what a node depends on.
 *
 * The graph is kept as an adjacency map of string keys rather than a class
 * with node objects, because the callers already have names and building
 * wrapper objects for them only adds a lookup.
 */

export type Adjacency = ReadonlyMap<string, readonly string[]>;

export function buildAdjacency(
  edges: Iterable<readonly [string, string]>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const existing = map.get(from);
    if (existing === undefined) {
      map.set(from, [to]);
    } else {
      existing.push(to);
    }
    if (!map.has(to)) {
      map.set(to, []);
    }
  }
  return map;
}

export function nodesOf(graph: Adjacency): string[] {
  const nodes = new Set<string>();
  for (const [from, targets] of graph) {
    nodes.add(from);
    for (const to of targets) {
      nodes.add(to);
    }
  }
  return [...nodes];
}

/**
 * Kahn's algorithm with ties broken alphabetically, so a topological order is
 * stable across runs. Returns nothing when the graph has a cycle, and the
 * caller is expected to reach for `findCycle` to report it.
 */
export function topologicalOrder(graph: Adjacency): string[] | undefined {
  const indegree = new Map<string, number>();
  for (const node of nodesOf(graph)) {
    indegree.set(node, 0);
  }
  for (const targets of graph.values()) {
    for (const to of targets) {
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }
  }
  const ready = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([node]) => node)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const node = ready.shift();
    if (node === undefined) {
      break;
    }
    order.push(node);
    for (const to of graph.get(node) ?? []) {
      const left = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, left);
      if (left === 0) {
        ready.push(to);
        ready.sort();
      }
    }
  }
  return order.length === indegree.size ? order : undefined;
}

/**
 * The first cycle reachable from any node, as the path around it with the
 * starting node repeated at the end. That repeat is deliberate, since a
 * diagnostic reads better as `a -> b -> a` than as `a -> b`.
 */
export function findCycle(graph: Adjacency): string[] | undefined {
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];

  const walk = (node: string): string[] | undefined => {
    const seen = state.get(node);
    if (seen === "done") {
      return undefined;
    }
    if (seen === "open") {
      const start = path.indexOf(node);
      return [...path.slice(start), node];
    }
    state.set(node, "open");
    path.push(node);
    for (const to of graph.get(node) ?? []) {
      const cycle = walk(to);
      if (cycle) {
        return cycle;
      }
    }
    path.pop();
    state.set(node, "done");
    return undefined;
  };

  for (const node of nodesOf(graph).sort()) {
    const cycle = walk(node);
    if (cycle) {
      return cycle;
    }
  }
  return undefined;
}

export function hasCycle(graph: Adjacency): boolean {
  return findCycle(graph) !== undefined;
}

/** Everything reachable from a node, not counting the node itself. */
export function reachableFrom(graph: Adjacency, start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [...(graph.get(start) ?? [])];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    seen.add(node);
    queue.push(...(graph.get(node) ?? []));
  }
  return seen;
}

/** Nodes nothing points at, which is where an include chain starts. */
export function roots(graph: Adjacency): string[] {
  const pointedAt = new Set<string>();
  for (const targets of graph.values()) {
    for (const to of targets) {
      pointedAt.add(to);
    }
  }
  return nodesOf(graph)
    .filter((node) => !pointedAt.has(node))
    .sort();
}

/** Nodes that point at nothing, which is where a chain bottoms out. */
export function leaves(graph: Adjacency): string[] {
  return nodesOf(graph)
    .filter((node) => (graph.get(node) ?? []).length === 0)
    .sort();
}

export function reverse(graph: Adjacency): Map<string, string[]> {
  const reversed = new Map<string, string[]>();
  for (const node of nodesOf(graph)) {
    reversed.set(node, []);
  }
  for (const [from, targets] of graph) {
    for (const to of targets) {
      reversed.get(to)?.push(from);
    }
  }
  for (const targets of reversed.values()) {
    targets.sort();
  }
  return reversed;
}
