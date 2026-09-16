/**
 * @param {number} amount
 * @param {number} rate
 * @param {number} [scale]
 */
export function convertAmount(amount, rate, scale = 2) {
  const factor = 10 ** scale
  const raw = amount * rate
  const scaled = raw * factor
  const floor = Math.floor(scaled + Number.EPSILON)
  const diff = scaled - floor
  if (Math.abs(diff - 0.5) < 1e-10) {
    return (floor % 2 === 0 ? floor : floor + 1) / factor
  }
  return Math.round(raw * factor) / factor
}

/**
 * @param {string} csv
 * @returns {Record<string, number>}
 */
export function parseRateTable(csv) {
  const rates = {}
  const lines = csv.trim().split(/\r?\n/)
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue
    const [pair, value] = line.split(',').map((part) => part.trim())
    const rate = Number(value)
    if (!pair || !/^[A-Z]{3}[A-Z]{3}$/.test(pair) || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid rate row: ${line}`)
    }
    rates[pair] = rate
  }
  return rates
}

/**
 * @param {Record<string, number>} rates
 * @param {string} from
 * @param {string} to
 */
export function lookupRate(rates, from, to) {
  if (from === to) return 1
  const direct = rates[`${from}${to}`]
  if (direct) return direct
  const inverse = rates[`${to}${from}`]
  if (inverse) return 1 / inverse
  throw new Error(`No FX rate for ${from}->${to}`)
}
