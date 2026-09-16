export class GraphCycleError extends Error {
  constructor(public readonly node: string) {
    super(`Cycle detected at ${node}`)
    this.name = 'GraphCycleError'
  }
}

export function createDependencyGraph() {
  const edges = new Map<string, Set<string>>()

  const dependents = (key: string) => {
    const found = new Set<string>()
    const visit = (node: string) => {
      for (const [parent, children] of edges) {
        if (parent === node) {
          for (const child of children) {
            if (!found.has(child)) {
              found.add(child)
              visit(child)
            }
          }
        }
      }
    }
    visit(key)
    return [...found]
  }

  const assertAcyclic = () => {
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const walk = (node: string) => {
      if (visiting.has(node)) throw new GraphCycleError(node)
      if (visited.has(node)) return
      visiting.add(node)
      for (const child of edges.get(node) ?? []) {
        walk(child)
      }
      visiting.delete(node)
      visited.add(node)
    }
    for (const node of edges.keys()) walk(node)
  }

  return {
    depend(child: string, parent: string) {
      const current = edges.get(parent) ?? new Set<string>()
      current.add(child)
      edges.set(parent, current)
      try {
        assertAcyclic()
      } catch (error) {
        current.delete(child)
        throw error
      }
    },
    invalidate(key: string) {
      return [key, ...dependents(key)]
    },
    rebuildOrder(dirty: string[]) {
      const needed = new Set(dirty.flatMap((key) => [key, ...dependents(key)]))
      const incoming = new Map<string, number>()
      for (const node of needed) incoming.set(node, 0)
      for (const [parent, children] of edges) {
        if (!needed.has(parent)) continue
        for (const child of children) {
          if (!needed.has(child)) continue
          incoming.set(child, (incoming.get(child) ?? 0) + 1)
        }
      }
      const ready = [...needed].filter((node) => (incoming.get(node) ?? 0) === 0).sort()
      const ordered: string[] = []
      while (ready.length > 0) {
        const node = ready.shift()!
        ordered.push(node)
        for (const child of [...(edges.get(node) ?? [])].sort()) {
          if (!needed.has(child)) continue
          incoming.set(child, (incoming.get(child) ?? 0) - 1)
          if (incoming.get(child) === 0) {
            ready.push(child)
            ready.sort()
          }
        }
      }
      if (ordered.length !== needed.size) {
        throw new GraphCycleError('rebuild')
      }
      return ordered
    },
  }
}
