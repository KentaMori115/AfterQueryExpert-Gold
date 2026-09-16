import { describe, expect, it } from 'vitest'
import { buildFxInvoice } from './builder'
import { lookupRate, parseRateTable } from './fx.js'

describe('buildFxInvoice', () => {
  const rates = `
# pair,rate
EURUSD,1.10
GBPUSD,1.25
`.trim()

  it('converts line items into the invoice currency then applies tax', () => {
    const invoice = buildFxInvoice({
      items: [
        { description: 'Design', quantity: 2, unitCents: 10_000, currency: 'EUR' },
        { description: 'Copy', quantity: 1, unitCents: 8_000, currency: 'GBP' },
      ],
      currency: 'USD',
      taxBps: 1000,
      ratesCsv: rates,
    })

    expect(invoice.lines[0].cents).toBe(22_000)
    expect(invoice.lines[1].cents).toBe(10_000)
    expect(invoice.subtotalCents).toBe(32_000)
    expect(invoice.taxCents).toBe(3_200)
    expect(invoice.totalCents).toBe(35_200)
  })

  it('uses the inverse rate when only the opposite pair is published', () => {
    const table = parseRateTable('USDEUR,0.5')
    expect(lookupRate(table, 'EUR', 'USD')).toBe(2)
    expect(() => parseRateTable('EURO,1')).toThrow(/Invalid rate row/)
  })
})
