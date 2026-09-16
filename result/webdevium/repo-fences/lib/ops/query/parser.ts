import { tokenize } from './lexer.js'

export type CompareOp = '=' | '!=' | '>' | '>=' | '<' | '<='

export type QueryNode =
  | { type: 'and' | 'or'; left: QueryNode; right: QueryNode }
  | { type: 'not'; inner: QueryNode }
  | { type: 'cmp'; field: string; op: CompareOp; value: string | number }

const ALLOWED_FIELDS = new Set(['title', 'status', 'priority', 'hours', 'assignee'])

type Token = { type: string; value: string }

export class QueryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryParseError'
  }
}

export function parseQuery(source: string): QueryNode {
  const tokens: Token[] = tokenize(source)
  let index = 0

  const peek = () => tokens[index]
  const take = () => {
    const token = tokens[index]
    if (!token) throw new QueryParseError('Unexpected end of query')
    index += 1
    return token
  }

  const parsePrimary = (): QueryNode => {
    const token = peek()
    if (!token) throw new QueryParseError('Expected expression')
    if (token.type === 'punct' && token.value === '(') {
      take()
      const inner = parseOr()
      const close = take()
      if (close.value !== ')') throw new QueryParseError('Expected closing parenthesis')
      return inner
    }
    if (token.type === 'ident' && token.value === 'not') {
      take()
      return { type: 'not', inner: parsePrimary() }
    }
    const field = take()
    if (field.type !== 'ident') throw new QueryParseError('Expected field')
    if (!ALLOWED_FIELDS.has(field.value)) {
      throw new QueryParseError(`Field "${field.value}" is not queryable`)
    }
    const op = take()
    if (op.type !== 'op') throw new QueryParseError('Expected comparison')
    const value = take()
    if (value.type !== 'string' && value.type !== 'number') {
      throw new QueryParseError('Expected literal')
    }
    return {
      type: 'cmp',
      field: field.value,
      op: op.value as CompareOp,
      value: value.type === 'number' ? Number(value.value) : value.value,
    }
  }

  const parseAnd = (): QueryNode => {
    let node = parsePrimary()
    while (peek()?.type === 'ident' && peek()?.value === 'and') {
      take()
      node = { type: 'and', left: node, right: parsePrimary() }
    }
    return node
  }

  const parseOr = (): QueryNode => {
    let node = parseAnd()
    while (peek()?.type === 'ident' && peek()?.value === 'or') {
      take()
      node = { type: 'or', left: node, right: parseAnd() }
    }
    return node
  }

  const ast = parseOr()
  if (index !== tokens.length) {
    throw new QueryParseError(`Unexpected token ${tokens[index]?.value}`)
  }
  return ast
}

export function compileQuery(source: string) {
  const ast = parseQuery(source)
  return (record: Record<string, string | number | undefined>) => evalNode(ast, record)
}

function evalNode(node: QueryNode, record: Record<string, string | number | undefined>): boolean {
  if (node.type === 'and') return evalNode(node.left, record) && evalNode(node.right, record)
  if (node.type === 'or') return evalNode(node.left, record) || evalNode(node.right, record)
  if (node.type === 'not') return !evalNode(node.inner, record)
  const left = record[node.field]
  if (left === undefined) return false
  switch (node.op) {
    case '=':
      return left === node.value
    case '!=':
      return left !== node.value
    case '>':
      return left > node.value
    case '>=':
      return left >= node.value
    case '<':
      return left < node.value
    case '<=':
      return left <= node.value
    default:
      return false
  }
}
