import type { RandomSource } from '../dice/roll'
import { pickFromTable } from './npc-tables'

export const TRINKETS: ReadonlyArray<string> = Object.freeze([
  'A small, brass key engraved with a leaping fox',
  'A folded letter, never opened, addressed to no one',
  'A bone die that always rolls even on the first throw',
  'A vial of cloudy water that warms when held',
  'A locket with a portrait that does not match anyone you know',
  'A glass eye with a hairline crack',
  'A petal pressed flat between two slips of silver',
  'A wax-sealed thumb cast in iron',
  'A wooden whistle that only attracts crows',
  'A tooth too large to be a wolf and too sharp to be a deer',
  'A pair of mismatched cufflinks, one carved from coal',
  'A pocket watch stopped at twenty past the hour',
  'A child is drawing of a knight, signed in a name you forget',
  'A ribbon embroidered with the words "again soon"',
  'A small bell that only rings underwater',
  'A polished river stone with a single rune scratched in',
  'A coin from a country that does not appear on any map',
  'A handful of dried mountain salt in a leather pouch',
  'A book of mirrors, every page blank',
  'A stick wrapped in three different colours of thread',
])

export const REGIONAL_TRINKETS: Record<string, ReadonlyArray<string>> = {
  coastal: [
    'A bottle of sand layered in three colours',
    'A pendant of polished shark tooth',
    'A scrap of sail stitched with a knot you cannot finish',
  ],
  desert: [
    'A square of dyed linen smelling of dust and cardamom',
    'A small carved camel bone die',
    'A jar of dried scarab beetles, lid sealed with wax',
  ],
  mountain: [
    'A bag of dried climbing herbs in a cedar tin',
    'A torn ribbon from a wind-blessing wreath',
    'A bone hairpin shaped like a horn',
  ],
  forest: [
    'A pressed leaf that hums when held to lips',
    'A small wooden bird that whistles when you walk',
    'A hollow acorn full of soft moss',
  ],
}

export interface TrinketSeed {
  description: string
  region: string | null
}

export function generateTrinket(rng: RandomSource, region: string | null = null): TrinketSeed {
  if (region && REGIONAL_TRINKETS[region] && rng() < 0.6) {
    return {
      description: pickFromTable(REGIONAL_TRINKETS[region], rng),
      region,
    }
  }
  return {
    description: pickFromTable(TRINKETS, rng),
    region: null,
  }
}

export function generateBatch(rng: RandomSource, count: number, region: string | null = null): TrinketSeed[] {
  const safeCount = Math.max(1, Math.min(20, Math.floor(count)))
  const out: TrinketSeed[] = []
  const seen = new Set<string>()
  let attempts = 0
  while (out.length < safeCount && attempts < safeCount * 5) {
    const seed = generateTrinket(rng, region)
    if (!seen.has(seed.description)) {
      seen.add(seed.description)
      out.push(seed)
    }
    attempts += 1
  }
  return out
}

export function knownRegions(): string[] {
  return Object.keys(REGIONAL_TRINKETS)
}
