import { expandRoles } from './graph'
import { ownResourceSatisfied, permissionMatches } from './match'
import type { AccessDecision, Principal, ResourceRef, Role } from './types'

export function createAccessEngine(roleList: Role[]) {
  const roles = new Map(roleList.map((role) => [role.name, role]))

  return {
    decide(principal: Principal, action: string, resource: ResourceRef): AccessDecision {
      const chain = expandRoles(roles, principal.roles)
      let grant: string | null = null

      for (const name of chain) {
        const role = roles.get(name)!
        for (const deny of role.denies) {
          if (
            permissionMatches(deny, action, resource) &&
            ownResourceSatisfied(deny, principal.id, resource)
          ) {
            return {
              allowed: false,
              matched: deny,
              via: 'deny',
              reason: `Denied by ${name} via ${deny}`,
            }
          }
        }
        for (const allowed of role.grants) {
          if (
            permissionMatches(allowed, action, resource) &&
            ownResourceSatisfied(allowed, principal.id, resource)
          ) {
            grant = allowed
          }
        }
      }

      if (grant) {
        return {
          allowed: true,
          matched: grant,
          via: 'grant',
          reason: `Granted via ${grant}`,
        }
      }

      return {
        allowed: false,
        matched: null,
        via: 'none',
        reason: 'No matching grant',
      }
    },
  }
}
