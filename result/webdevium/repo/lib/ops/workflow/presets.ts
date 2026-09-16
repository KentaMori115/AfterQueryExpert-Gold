import { createMachine } from './machine'

export type TaskWorkflowContext = {
  assigneeId: string | null
  hours: number
  blocked: boolean
}

export function createTaskWorkflow(initial?: Partial<TaskWorkflowContext>) {
  return createMachine<TaskWorkflowContext>({
    id: 'task',
    initial: 'queued',
    context: {
      assigneeId: null,
      hours: 0,
      blocked: false,
      ...initial,
    },
    transitions: [
      {
        from: 'queued',
        to: 'in_progress',
        on: 'start',
        guard: (context) => Boolean(context.assigneeId) && !context.blocked,
        compensate: 'release',
      },
      { from: 'in_progress', to: 'queued', on: 'release' },
      {
        from: 'in_progress',
        to: 'review',
        on: 'submit',
        guard: (context) => context.hours > 0,
        compensate: 'reject',
      },
      { from: 'review', to: 'in_progress', on: 'reject' },
      { from: 'review', to: 'done', on: 'approve' },
      { from: ['queued', 'in_progress', 'review'], to: 'blocked', on: 'block' },
      {
        from: 'blocked',
        to: 'queued',
        on: 'unblock',
      },
    ],
  })
}
