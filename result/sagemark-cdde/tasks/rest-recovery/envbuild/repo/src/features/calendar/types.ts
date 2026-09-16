import type { CalendarDay } from '@core/lib/inworld-calendar'

export type CalendarEventTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral'

export interface CalendarMarkedEvent {
  date: CalendarDay
  label: string
  tone?: CalendarEventTone
}
