export type PermissionAction = string
export type ResourceRef = {
  type: string
  id?: string
  ownerId?: string
}

export type Role = {
  name: string
  parents: string[]
  grants: string[]
  denies: string[]
}

export type Principal = {
  id: string
  roles: string[]
}

export type AccessDecision = {
  allowed: boolean
  matched: string | null
  via: 'grant' | 'deny' | 'none'
  reason: string
}
