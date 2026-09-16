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
