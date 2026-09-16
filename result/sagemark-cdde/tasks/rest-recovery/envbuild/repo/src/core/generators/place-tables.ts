import type { RandomSource } from '../dice/roll'
import { pickFromTable } from './npc-tables'

export const TAVERN_ADJECTIVES: ReadonlyArray<string> = Object.freeze([
  'Bent',
  'Brass',
  'Hollow',
  'Iron',
  'Drunken',
  'Lonely',
  'Salt',
  'Silver',
  'Sleeping',
  'Stone',
  'Twin',
  'Wandering',
  'Whispering',
  'Yellow',
  'Pale',
])

export const TAVERN_NOUNS: ReadonlyArray<string> = Object.freeze([
  'Bell',
  'Boar',
  'Crow',
  'Crown',
  'Hare',
  'Hound',
  'Lantern',
  'Mast',
  'Mug',
  'Owl',
  'Quill',
  'Raven',
  'Rose',
  'Shilling',
  'Stag',
  'Thistle',
  'Wagon',
  'Wolf',
])

export const STREET_NAMES: ReadonlyArray<string> = Object.freeze([
  'Old Coopers',
  'Brewer Row',
  'Saint Eilis',
  'Tanner Lane',
  'Five Bridges',
  'Hangman',
  'Salt Quay',
  'Iron Square',
  'Penny',
  'Goose',
  'Foundry',
  'Watch',
  'Mill Wynd',
  'Lower Cross',
])

export const RUMOR_TEMPLATES: ReadonlyArray<string> = Object.freeze([
  'They say the {place} has gone quiet again, third week running.',
  'A traveller from {place} claims the stars sit lower this season.',
  'The watch caught two children counting graves near {place}.',
  'No one will sell rope on {place} after sundown anymore.',
  'A bell rings every dawn under {place} and no one will admit to it.',
  'The cooper on {place} swears their casks weigh more after dark.',
  'Lights move along the south wall of {place} on the nights between feasts.',
])

export interface TavernSeed {
  name: string
}

export interface StreetSeed {
  name: string
}

export interface RumorSeed {
  text: string
  place: string
}

export function generateTavernName(rng: RandomSource): TavernSeed {
  const adj = pickFromTable(TAVERN_ADJECTIVES, rng)
  const noun = pickFromTable(TAVERN_NOUNS, rng)
  return { name: `The ${adj} ${noun}` }
}

export function generateStreetName(rng: RandomSource): StreetSeed {
  const base = pickFromTable(STREET_NAMES, rng)
  const flavour = pickFromTable(['Way', 'Street', 'Row', 'Lane', 'Walk'] as const, rng)
  return { name: `${base} ${flavour}` }
}

export function generateRumor(rng: RandomSource, placeNames: ReadonlyArray<string>): RumorSeed {
  const template = pickFromTable(RUMOR_TEMPLATES, rng)
  const pool = placeNames.length > 0 ? placeNames : ['the Old Quarter']
  const place = pickFromTable(pool, rng)
  return { text: template.replace('{place}', place), place }
}
