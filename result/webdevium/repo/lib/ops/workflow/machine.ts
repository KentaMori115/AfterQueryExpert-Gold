export type WorkflowState = string

export type Transition<C> = {
  from: WorkflowState | WorkflowState[]
  to: WorkflowState
  on: string
  guard?: (context: C) => boolean
  compensate?: string
}

export type WorkflowEvent<C> = {
  type: string
  at: number
  context?: Partial<C>
}

export class IllegalTransitionError extends Error {
  constructor(public readonly from: string, public readonly event: string) {
    super(`Cannot handle ${event} from ${from}`)
    this.name = 'IllegalTransitionError'
  }
}

export function createMachine<C extends Record<string, unknown>>(config: {
  id: string
  initial: WorkflowState
  context: C
  transitions: Transition<C>[]
}) {
  let state = config.initial
  let context = { ...config.context }
  const history: { state: WorkflowState; event: string; at: number }[] = [
    { state, event: '__start__', at: 0 },
  ]

  const matches = (from: Transition<C>['from'], current: WorkflowState) =>
    Array.isArray(from) ? from.includes(current) : from === current

  return {
    get state() {
      return state
    },
    get context() {
      return { ...context }
    },
    history() {
      return [...history]
    },
    send(event: WorkflowEvent<C>) {
      const candidates = config.transitions.filter(
        (transition) => transition.on === event.type && matches(transition.from, state)
      )
      const chosen = candidates.find((transition) =>
        transition.guard ? transition.guard({ ...context, ...event.context } as C) : true
      )
      if (!chosen) {
        throw new IllegalTransitionError(state, event.type)
      }
      if (event.context) {
        context = { ...context, ...event.context }
      }
      state = chosen.to
      history.push({ state, event: event.type, at: event.at })
      return { state, context: { ...context }, compensate: chosen.compensate ?? null }
    },
    compensate(at: number) {
      const last = [...history].reverse().find((item) => item.event !== '__start__')
      if (!last) {
        throw new Error('Nothing to compensate')
      }
      const transition = config.transitions.find(
        (item) => item.on === last.event && item.to === last.state
      )
      if (!transition?.compensate) {
        throw new Error(`No compensation for ${last.event}`)
      }
      return this.send({ type: transition.compensate, at })
    },
  }
}
