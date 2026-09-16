export function roundHalfEven(value: number, scale = 2) {
  const factor = 10 ** scale
  const scaled = value * factor
  const floor = Math.floor(scaled + 1e-10)
  const diff = scaled - floor
  if (diff > 0.5 + 1e-10) return (floor + 1) / factor
  if (diff < 0.5 - 1e-10) return floor / factor
  return (floor % 2 === 0 ? floor : floor + 1) / factor
}

export function cents(value: number) {
  return Math.round(roundHalfEven(value, 2) * 100)
}

export function fromCents(value: number) {
  return value / 100
}

/**
 * Hours priced at a per-hour rate. Both sides are already the figures the
 * statement shows, so the product is the charge a client can reproduce with
 * a calculator rather than one that only comes out in floating point.
 */
export function centsFromHours(hours: number, centsPerHour: number) {
  if (hours <= 0) return 0
  return roundHalfEven(hours * centsPerHour, 0)
}

/** Add a run of cent figures without letting a stray undefined through. */
export function sumCents(values: number[]) {
  return values.reduce((running, value) => running + (value || 0), 0)
}

/**
 * Which entry absorbs a rounding remainder: the heaviest one, and the
 * earliest of those when two carry the same weight. Putting it on the largest
 * figure keeps the correction proportionally smallest, and keeps it in one
 * place rather than smeared across a page of lines.
 */
export function heaviestIndex(amounts: number[]) {
  let best = -1
  let weight = -1
  for (let index = 0; index < amounts.length; index += 1) {
    const size = Math.abs(amounts[index])
    if (size > weight) {
      weight = size
      best = index
    }
  }
  return best
}

/** How far a set of independently rounded figures sits from its own total. */
export function residualCents(amounts: number[], totalCents: number) {
  return totalCents - sumCents(amounts)
}

/**
 * Nudge a set of independently rounded amounts so they add up to the total
 * that was rounded once. Only one entry moves, and only by the remainder, so
 * every other figure on the statement is the one its own arithmetic produced.
 */
export function settleRounding(amounts: number[], totalCents: number) {
  const settled = [...amounts]
  const residual = residualCents(settled, totalCents)
  if (residual === 0 || settled.length === 0) return settled
  const target = heaviestIndex(settled)
  settled[target] += residual
  return settled
}
