/**
 * @typedef {{ type: 'ident' | 'string' | 'number' | 'op' | 'punct'; value: string }} Token
 */

const OPS = ['!=', '>=', '<=', '=', '>', '<']

/**
 * @param {string} source
 * @returns {Token[]}
 */
export function tokenize(source) {
  const tokens = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      let value = ''
      i += 1
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) {
          value += source[i + 1]
          i += 2
          continue
        }
        value += source[i]
        i += 1
      }
      if (source[i] !== quote) {
        throw new Error('Unterminated string')
      }
      i += 1
      tokens.push({ type: 'string', value })
      continue
    }
    const pair = source.slice(i, i + 2)
    if (OPS.includes(pair)) {
      tokens.push({ type: 'op', value: pair })
      i += 2
      continue
    }
    if (OPS.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }
    if ('()'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch })
      i += 1
      continue
    }
    if (/[0-9]/.test(ch)) {
      let value = ''
      while (i < source.length && /[0-9.]/.test(source[i])) {
        value += source[i]
        i += 1
      }
      tokens.push({ type: 'number', value })
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let value = ''
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
        value += source[i]
        i += 1
      }
      tokens.push({ type: 'ident', value: value.toLowerCase() })
      continue
    }
    throw new Error(`Unexpected character ${ch}`)
  }
  return tokens
}
