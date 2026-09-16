export interface DiceTerm {
  kind: 'dice'
  count: number
  sides: number
  modifier: 'none' | 'keep-highest' | 'keep-lowest' | 'advantage' | 'disadvantage'
  modifierAmount?: number
}

export interface ConstantTerm {
  kind: 'constant'
  value: number
}

export type RollTerm = DiceTerm | ConstantTerm

export interface RollExpression {
  terms: ReadonlyArray<RollTerm>
  signs: ReadonlyArray<1 | -1>
}

export class DiceParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiceParseError'
  }
}

const DICE_PATTERN = /^(\d*)d(\d+)(kh\d+|kl\d+|adv|dis)?$/i

export function parseRollExpression(input: string): RollExpression {
  if (!input || !input.trim()) {
    throw new DiceParseError('expression is empty')
  }
  const normalised = input.replace(/\s+/g, '').toLowerCase()

  const tokens: string[] = []
  let current = ''
  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i]!
    if ((ch === '+' || ch === '-') && current.length > 0) {
      tokens.push(current)
      tokens.push(ch)
      current = ''
    } else if ((ch === '+' || ch === '-') && current.length === 0) {
      // leading sign on the first term
      current += ch
    } else {
      current += ch
    }
  }
  if (current.length > 0) tokens.push(current)

  const terms: RollTerm[] = []
  const signs: Array<1 | -1> = []
  let pendingSign: 1 | -1 = 1

  for (const tok of tokens) {
    if (tok === '+') {
      pendingSign = 1
      continue
    }
    if (tok === '-') {
      pendingSign = -1
      continue
    }
    const piece = tok.startsWith('+') ? tok.slice(1) : tok
    const negated = piece.startsWith('-')
    const body = negated ? piece.slice(1) : piece
    if (!body) {
      throw new DiceParseError(`stray sign in "${input}"`)
    }
    const sign: 1 | -1 = negated ? (pendingSign === 1 ? -1 : 1) : pendingSign
    if (DICE_PATTERN.test(body)) {
      terms.push(parseDice(body))
    } else if (/^\d+$/.test(body)) {
      terms.push({ kind: 'constant', value: Number(body) })
    } else {
      throw new DiceParseError(`unrecognised term "${tok}"`)
    }
    signs.push(sign)
    pendingSign = 1
  }

  if (terms.length === 0) {
    throw new DiceParseError(`no terms in "${input}"`)
  }
  return { terms, signs }
}

function parseDice(token: string): DiceTerm {
  const m = DICE_PATTERN.exec(token)
  if (!m) throw new DiceParseError(`bad dice term "${token}"`)
  const countText = m[1]!
  const sidesText = m[2]!
  const modifierText = m[3]?.toLowerCase() ?? ''
  const count = countText === '' ? 1 : Number(countText)
  const sides = Number(sidesText)
  if (count < 1 || count > 100) {
    throw new DiceParseError(`die count out of range in "${token}"`)
  }
  if (sides < 2 || sides > 1000) {
    throw new DiceParseError(`die size out of range in "${token}"`)
  }
  let modifier: DiceTerm['modifier'] = 'none'
  let modifierAmount: number | undefined
  if (modifierText.startsWith('kh')) {
    modifier = 'keep-highest'
    modifierAmount = Number(modifierText.slice(2))
    if (!Number.isInteger(modifierAmount) || modifierAmount < 1 || modifierAmount > count) {
      throw new DiceParseError(`keep-highest amount invalid in "${token}"`)
    }
  } else if (modifierText.startsWith('kl')) {
    modifier = 'keep-lowest'
    modifierAmount = Number(modifierText.slice(2))
    if (!Number.isInteger(modifierAmount) || modifierAmount < 1 || modifierAmount > count) {
      throw new DiceParseError(`keep-lowest amount invalid in "${token}"`)
    }
  } else if (modifierText === 'adv') {
    if (count !== 1) {
      throw new DiceParseError('advantage only applies to a single die')
    }
    modifier = 'advantage'
  } else if (modifierText === 'dis') {
    if (count !== 1) {
      throw new DiceParseError('disadvantage only applies to a single die')
    }
    modifier = 'disadvantage'
  }
  return { kind: 'dice', count, sides, modifier, modifierAmount }
}

export function formatExpression(expr: RollExpression): string {
  const parts: string[] = []
  for (let i = 0; i < expr.terms.length; i++) {
    const sign = expr.signs[i] ?? 1
    const term = expr.terms[i]!
    const piece = formatTerm(term)
    if (i === 0) {
      parts.push(sign === -1 ? `-${piece}` : piece)
    } else {
      parts.push(sign === -1 ? `- ${piece}` : `+ ${piece}`)
    }
  }
  return parts.join(' ')
}

function formatTerm(term: RollTerm): string {
  if (term.kind === 'constant') return String(term.value)
  let base = `${term.count}d${term.sides}`
  if (term.modifier === 'keep-highest') base += `kh${term.modifierAmount}`
  else if (term.modifier === 'keep-lowest') base += `kl${term.modifierAmount}`
  else if (term.modifier === 'advantage') base += 'adv'
  else if (term.modifier === 'disadvantage') base += 'dis'
  return base
}
