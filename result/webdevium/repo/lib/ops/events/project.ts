import type { DomainEvent } from './stream'

export type TaskProjection = {
  id: string
  title: string
  status: 'queued' | 'in_progress' | 'done'
  hours: number
  version: number
}

export function projectTask(
  events: DomainEvent[],
  seed: TaskProjection | null = null
): TaskProjection | null {
  let current = seed
  for (const event of events) {
    if (event.type === 'task.created') {
      current = {
        id: String(event.payload.id),
        title: String(event.payload.title),
        status: 'queued',
        hours: 0,
        version: event.version,
      }
      continue
    }
    if (!current) continue
    if (event.type === 'task.renamed') {
      current = { ...current, title: String(event.payload.title), version: event.version }
    } else if (event.type === 'task.started') {
      current = { ...current, status: 'in_progress', version: event.version }
    } else if (event.type === 'task.hours_logged') {
      current = {
        ...current,
        hours: current.hours + Number(event.payload.hours),
        version: event.version,
      }
    } else if (event.type === 'task.completed') {
      current = { ...current, status: 'done', version: event.version }
    }
  }
  return current
}

export function replayFromSnapshot(
  snapshot: { version: number; state: TaskProjection } | null,
  events: DomainEvent[]
) {
  const tail = events.filter((event) => event.version > (snapshot?.version ?? 0))
  return projectTask(tail, snapshot?.state ?? null)
}
