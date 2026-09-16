import { z } from 'zod'

import type { CampaignId } from '@core/ids'
import type { CharacterDraftInput } from '@core/models/character'

export interface CsvImportResult {
  ok: boolean
  imported: CharacterDraftInput[]
  errors: Array<{ row: number; message: string }>
}

const rowSchema = z.object({
  name: z.string().trim().min(1, 'name required'),
  kind: z.enum(['pc', 'npc']).optional(),
  ancestry: z.string().trim().optional(),
  vocation: z.string().trim().optional(),
  level: z.coerce.number().int().min(0).max(40).optional(),
  pronouns: z.string().trim().optional(),
})

export function parseCharactersCsv(text: string, campaignId: CampaignId): CsvImportResult {
  const out: CharacterDraftInput[] = []
  const errors: Array<{ row: number; message: string }> = []

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) {
    return { ok: false, imported: [], errors: [{ row: 0, message: 'empty file' }] }
  }

  const header = splitCsvLine(lines[0]!).map((c) => c.toLowerCase().trim())
  const indexOf = (name: string): number => header.indexOf(name)
  const nameIdx = indexOf('name')
  if (nameIdx === -1) {
    return { ok: false, imported: [], errors: [{ row: 0, message: 'csv must have a "name" column' }] }
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!)
    const obj: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) {
      const key = header[c]
      if (!key) continue
      obj[key] = (cells[c] ?? '').trim()
    }
    const parsed = rowSchema.safeParse(obj)
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'invalid row' })
      continue
    }
    out.push({ campaignId, ...parsed.data })
  }

  return {
    ok: errors.length === 0,
    imported: out,
    errors,
  }
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else if (ch === '"' && cur.length === 0) {
      inQuotes = true
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}
