import type { Role } from './types'

export class RoleCycleError extends Error {
  constructor(path: string[]) {
    super(`Role inheritance cycle: ${path.join(' -> ')}`)
    this.name = 'RoleCycleError'
  }
}

export function expandRoles(roles: Map<string, Role>, start: string[]) {
  const inherited: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const walk = (name: string, path: string[]) => {
    if (visiting.has(name)) {
      throw new RoleCycleError([...path, name])
    }
    if (visited.has(name)) return
    const role = roles.get(name)
    if (!role) {
      throw new Error(`Unknown role ${name}`)
    }
    visiting.add(name)
    for (const parent of role.parents) {
      walk(parent, [...path, name])
    }
    visiting.delete(name)
    visited.add(name)
    inherited.push(name)
  }

  for (const name of start) {
    walk(name, [])
  }
  return inherited
}
