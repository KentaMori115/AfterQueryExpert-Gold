// Trail rations for a party on the road. A ration is one person for one day,
// counted whole: half a ration feeds nobody. The ledger only ever goes down
// here, since restocking happens in town and that is the campaign's business,
// not the road's.

export interface SupplyState {
  /** Whole rations still in the packs. Never negative. */
  rations: number
  /** How many days ended with fewer rations than mouths at the fire. */
  hungryDays: number
}

export interface SupplyDraw {
  /** The ledger after the draw. */
  state: SupplyState
  /** Rations that actually came out of the packs. */
  drawn: number
  /** Mouths the packs could not cover. */
  short: number
}

/** A fresh ledger. Fractions and nonsense round down to a whole ration. */
export function startingSupply(rations: number): SupplyState {
  return { rations: wholeRations(rations), hungryDays: 0 }
}

/**
 * Feed `mouths` people for one day. The packs give what they have; anything
 * they cannot cover is short, and a day short by any amount is one hungry day,
 * not one per empty stomach.
 */
export function drawRations(state: SupplyState, mouths: number): SupplyDraw {
  const wanted = Math.max(0, Math.floor(mouths))
  const have = wholeRations(state.rations)
  const drawn = Math.min(have, wanted)
  const short = wanted - drawn
  return {
    state: {
      rations: have - drawn,
      hungryDays: state.hungryDays + (short > 0 ? 1 : 0),
    },
    drawn,
    short,
  }
}

/**
 * Days the packs can feed `mouths`, rounded down. A party of nobody eats
 * nothing and can sit on the road forever, which is reported as zero days
 * rather than an infinity nobody can render.
 */
export function daysOfFood(state: SupplyState, mouths: number): number {
  const wanted = Math.max(0, Math.floor(mouths))
  if (wanted === 0) return 0
  return Math.floor(wholeRations(state.rations) / wanted)
}

/** Take rations out of the packs without feeding anyone: spoilage, theft, a river. */
export function loseRations(state: SupplyState, count: number): SupplyState {
  const lost = Math.max(0, Math.floor(count))
  if (lost === 0) return state
  return { ...state, rations: Math.max(0, wholeRations(state.rations) - lost) }
}

function wholeRations(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}
