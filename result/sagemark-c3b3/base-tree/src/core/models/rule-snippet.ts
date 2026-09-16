import { z } from 'zod'

import type { ISOTimestamp } from '../time/timestamps'

export type RuleScope = 'combat' | 'magic' | 'exploration' | 'social' | 'downtime'

export const RULE_SCOPES: ReadonlyArray<RuleScope> = [
  'combat',
  'magic',
  'exploration',
  'social',
  'downtime',
]

const SCOPE_LABELS: Record<RuleScope, string> = {
  combat: 'Combat',
  magic: 'Magic',
  exploration: 'Exploration',
  social: 'Social',
  downtime: 'Downtime',
}

const SCOPE_TONES: Record<RuleScope, 'danger' | 'warning' | 'info' | 'success' | 'neutral'> = {
  combat: 'danger',
  magic: 'warning',
  exploration: 'info',
  social: 'success',
  downtime: 'neutral',
}

export function ruleScopeLabel(scope: RuleScope): string {
  return SCOPE_LABELS[scope]
}

export function ruleScopeTone(
  scope: RuleScope,
): 'danger' | 'warning' | 'info' | 'success' | 'neutral' {
  return SCOPE_TONES[scope]
}

export interface RuleSnippet {
  id: string
  title: string
  scope: RuleScope
  body: string
  source: string
  pinned: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface RuleSnippetDraft {
  title: string
  scope: RuleScope
  body: string
  source?: string
  pinned?: boolean
}

export const ruleSnippetDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  scope: z.enum(RULE_SCOPES as unknown as [RuleScope, ...RuleScope[]]),
  body: z.string().trim().min(1).max(2000),
  source: z.string().max(120).optional(),
  pinned: z.boolean().optional(),
})

export function compareForListing(a: RuleSnippet, b: RuleSnippet): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.scope !== b.scope) return a.scope.localeCompare(b.scope)
  return a.title.localeCompare(b.title)
}
