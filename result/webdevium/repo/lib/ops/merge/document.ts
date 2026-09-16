import { compareClocks, mergeClocks, tick, type VectorClock } from './clock'

export type TextOp =
  | { kind: 'insert'; at: number; text: string; actor: string; clock: VectorClock }
  | { kind: 'delete'; at: number; length: number; actor: string; clock: VectorClock }

export type DocumentState = {
  text: string
  clock: VectorClock
}

export function applyOp(state: DocumentState, op: TextOp): DocumentState {
  const relation = compareClocks(op.clock, state.clock)
  if (relation === 'before' || relation === 'equal') {
    return state
  }

  let text = state.text
  if (op.kind === 'insert') {
    const at = Math.max(0, Math.min(op.at, text.length))
    text = text.slice(0, at) + op.text + text.slice(at)
  } else {
    const at = Math.max(0, Math.min(op.at, text.length))
    text = text.slice(0, at) + text.slice(at + Math.max(0, op.length))
  }

  return {
    text,
    clock: mergeClocks(state.clock, op.clock),
  }
}

export function transform(op: TextOp, against: TextOp): TextOp {
  if (op.kind === 'insert' && against.kind === 'insert') {
    if (against.at < op.at || (against.at === op.at && against.actor < op.actor)) {
      return { ...op, at: op.at + against.text.length }
    }
    return op
  }
  if (op.kind === 'insert' && against.kind === 'delete') {
    if (against.at < op.at) {
      return { ...op, at: Math.max(against.at, op.at - against.length) }
    }
    return op
  }
  if (op.kind === 'delete' && against.kind === 'insert') {
    if (against.at <= op.at) {
      return { ...op, at: op.at + against.text.length }
    }
    return op
  }
  if (op.kind === 'delete' && against.kind === 'delete') {
    if (against.at >= op.at + op.length) return op
    if (against.at + against.length <= op.at) {
      return { ...op, at: op.at - against.length }
    }
    const start = Math.min(op.at, against.at)
    const end = Math.max(op.at + op.length, against.at + against.length)
    return { ...op, at: start, length: Math.max(0, end - start - against.length) }
  }
  return op
}

export function localInsert(state: DocumentState, actor: string, at: number, text: string) {
  const clock = tick(state.clock, actor)
  const op: TextOp = { kind: 'insert', at, text, actor, clock }
  return { state: applyOp(state, op), op }
}
