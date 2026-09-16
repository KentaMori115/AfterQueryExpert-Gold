declare const __brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [__brand]: B }

export type CampaignId = Brand<string, 'CampaignId'>
export type CharacterId = Brand<string, 'CharacterId'>
export type FactionId = Brand<string, 'FactionId'>
export type LocationId = Brand<string, 'LocationId'>
export type SessionId = Brand<string, 'SessionId'>
export type ArcId = Brand<string, 'ArcId'>
export type EncounterId = Brand<string, 'EncounterId'>
export type RelationshipId = Brand<string, 'RelationshipId'>
export type LoreId = Brand<string, 'LoreId'>
export type ItemId = Brand<string, 'ItemId'>
export type QuestId = Brand<string, 'QuestId'>
export type TimelineEventId = Brand<string, 'TimelineEventId'>
export type NoteId = Brand<string, 'NoteId'>
export type TagId = Brand<string, 'TagId'>

export const asCampaignId = (s: string): CampaignId => s as CampaignId
export const asCharacterId = (s: string): CharacterId => s as CharacterId
export const asFactionId = (s: string): FactionId => s as FactionId
export const asLocationId = (s: string): LocationId => s as LocationId
export const asSessionId = (s: string): SessionId => s as SessionId
export const asArcId = (s: string): ArcId => s as ArcId
export const asEncounterId = (s: string): EncounterId => s as EncounterId
export const asRelationshipId = (s: string): RelationshipId => s as RelationshipId
export const asLoreId = (s: string): LoreId => s as LoreId
export const asItemId = (s: string): ItemId => s as ItemId
export const asQuestId = (s: string): QuestId => s as QuestId
export const asTimelineEventId = (s: string): TimelineEventId => s as TimelineEventId
export const asNoteId = (s: string): NoteId => s as NoteId
export const asTagId = (s: string): TagId => s as TagId

export type AnyId =
  | CampaignId
  | CharacterId
  | FactionId
  | LocationId
  | SessionId
  | ArcId
  | EncounterId
  | RelationshipId
  | LoreId
  | ItemId
  | QuestId
  | TimelineEventId
  | NoteId
  | TagId
