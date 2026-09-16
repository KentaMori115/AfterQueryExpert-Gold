import { convertAmount, lookupRate, parseRateTable } from './fx.js'

export type InvoiceItem = {
  description: string
  quantity: number
  unitCents: number
  currency: string
}

export type BuiltInvoice = {
  currency: string
  lines: { description: string; cents: number }[]
  subtotalCents: number
  taxCents: number
  totalCents: number
}

export function buildFxInvoice(input: {
  items: InvoiceItem[]
  currency: string
  taxBps: number
  ratesCsv: string
}): BuiltInvoice {
  if (input.taxBps < 0) throw new Error('taxBps must be >= 0')
  const rates = parseRateTable(input.ratesCsv)
  const lines = input.items.map((item) => {
    const rate = lookupRate(rates, item.currency, input.currency)
    const native = (item.quantity * item.unitCents) / 100
    const converted = convertAmount(native, rate, 2)
    return {
      description: item.description,
      cents: Math.round(converted * 100),
    }
  })
  const subtotalCents = lines.reduce((sum, line) => sum + line.cents, 0)
  const taxCents = Math.round((subtotalCents * input.taxBps) / 10_000)
  return {
    currency: input.currency,
    lines,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  }
}
