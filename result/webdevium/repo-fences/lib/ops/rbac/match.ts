import type { ResourceRef } from './types'

export function parsePermission(raw: string) {
  const [action, resource, qualifier] = raw.split(':')
  if (!action || !resource) {
    throw new Error(`Invalid permission "${raw}"`)
  }
  return { action, resource, qualifier: qualifier ?? '*' }
}

export function permissionMatches(
  granted: string,
  action: string,
  resource: ResourceRef
) {
  const rule = parsePermission(granted)
  const actionOk = rule.action === '*' || rule.action === action
  const typeOk = rule.resource === '*' || rule.resource === resource.type
  const idOk =
    rule.qualifier === '*' ||
    rule.qualifier === resource.id ||
    (rule.qualifier === 'own' && Boolean(resource.ownerId))
  return actionOk && typeOk && idOk
}

export function ownResourceSatisfied(granted: string, actorId: string, resource: ResourceRef) {
  const rule = parsePermission(granted)
  if (rule.qualifier !== 'own') return true
  return resource.ownerId === actorId
}
