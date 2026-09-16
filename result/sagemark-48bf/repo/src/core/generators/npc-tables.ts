// Seeded tables used by the NPC quick generator. Each table is a frozen list
// so callers cannot mutate it by accident. Names and vocations come from a
// hand-curated palette that fits the late-medieval-with-magic vibe of the rest
// of the app.

export const GIVEN_NAMES: ReadonlyArray<string> = Object.freeze([
  'Alric',
  'Brann',
  'Cael',
  'Doryn',
  'Eilis',
  'Faron',
  'Gisla',
  'Hale',
  'Iris',
  'Jora',
  'Kestrel',
  'Lir',
  'Marra',
  'Nyle',
  'Oraen',
  'Perrin',
  'Quill',
  'Ronan',
  'Sable',
  'Thessa',
  'Ula',
  'Vorr',
  'Wenna',
  'Yael',
])

export const SURNAMES: ReadonlyArray<string> = Object.freeze([
  'Ashwhile',
  'Brackford',
  'Coldspire',
  'Drennan',
  'Elderbrook',
  'Foxgrove',
  'Greymoor',
  'Hollowell',
  'Ironreach',
  'Karrigan',
  'Lockfen',
  'Marchwood',
  'Northcairn',
  'Orrick',
  'Penroth',
  'Quintergale',
  'Redhowe',
  'Stonebough',
  'Thrushmere',
  'Underbrace',
  'Veilcroft',
  'Wendholm',
])

export const VOCATIONS: ReadonlyArray<string> = Object.freeze([
  'tavern keeper',
  'blacksmith',
  'apothecary',
  'caravan guard',
  'fletcher',
  'scribe',
  'tanner',
  'wandering scholar',
  'priest of the Veil',
  'mercenary captain',
  'fish monger',
  'cartographer',
  'street herbalist',
  'rat catcher',
  'pit fighter',
  'thatcher',
  'minor noble',
  'hedge wizard',
  'animal handler',
  'silversmith',
])

export const QUIRKS: ReadonlyArray<string> = Object.freeze([
  'never makes eye contact',
  'hums an old march without realising',
  'collects buttons',
  'has a tattoo of a name they will not say',
  'flinches at loud iron',
  'always smells faintly of cloves',
  'cannot stand the colour green',
  'speaks to their own shadow',
  'wears mismatched gloves on purpose',
  'starts every story with the weather',
  'keeps a folded letter, never opened',
  'whittles small animals while talking',
  'reads palms for free, badly',
  'flips a clipped coin when nervous',
  'never sleeps with the door shut',
])

export const MOTIVATIONS: ReadonlyArray<string> = Object.freeze([
  'pay off a debt to a worse person',
  'find a sibling who walked into the fog',
  'be remembered by the city watch in a good way',
  'keep their guild charter from being revoked',
  'avoid the queen of cups in the next deal',
  'prove a dead teacher right',
  'open a second shop across the river',
  'reclaim a name struck from a family register',
  'finish a song that has eaten ten years',
  'keep a promise to a horse',
])

export const DISPOSITIONS: ReadonlyArray<string> = Object.freeze([
  'wary',
  'cordial',
  'curious',
  'fond',
  'suspicious',
  'aloof',
  'enthusiastic',
  'tired',
])

export interface NpcSeed {
  name: string
  vocation: string
  quirk: string
  motivation: string
  disposition: string
}

export function pickFromTable<T>(table: ReadonlyArray<T>, rng: () => number): T {
  if (table.length === 0) throw new Error('cannot pick from an empty table')
  const idx = Math.floor(rng() * table.length) % table.length
  return table[idx] as T
}

export function generateNpcSeed(rng: () => number): NpcSeed {
  const given = pickFromTable(GIVEN_NAMES, rng)
  const surname = pickFromTable(SURNAMES, rng)
  return {
    name: `${given} ${surname}`,
    vocation: pickFromTable(VOCATIONS, rng),
    quirk: pickFromTable(QUIRKS, rng),
    motivation: pickFromTable(MOTIVATIONS, rng),
    disposition: pickFromTable(DISPOSITIONS, rng),
  }
}

export function formatNpcSeed(seed: NpcSeed): string {
  return [
    seed.name,
    `${seed.vocation}, ${seed.disposition}`,
    `Quirk: ${seed.quirk}`,
    `Wants: ${seed.motivation}`,
  ].join('\n')
}
