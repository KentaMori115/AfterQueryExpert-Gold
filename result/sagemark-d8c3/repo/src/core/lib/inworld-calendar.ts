// Helpers for rendering a configurable in world calendar where every month has
// the same number of days. This is intentionally simple. It does not try to
// model leap years or named months because most home brew calendars do not.

export interface CalendarShape {
  monthsPerYear: number
  daysPerMonth: number
}

export interface CalendarDay {
  year: number
  month: number
  day: number
}

export interface CalendarGridCell {
  day: number
  index: number
  isFirstOfMonth: boolean
  isToday: boolean
}

export class CalendarError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalendarError'
  }
}

export function assertShape(shape: CalendarShape): void {
  if (!Number.isInteger(shape.monthsPerYear) || shape.monthsPerYear < 1 || shape.monthsPerYear > 36) {
    throw new CalendarError('monthsPerYear must be an integer between 1 and 36')
  }
  if (!Number.isInteger(shape.daysPerMonth) || shape.daysPerMonth < 1 || shape.daysPerMonth > 60) {
    throw new CalendarError('daysPerMonth must be an integer between 1 and 60')
  }
}

export function totalDaysPerYear(shape: CalendarShape): number {
  assertShape(shape)
  return shape.monthsPerYear * shape.daysPerMonth
}

export function daysBetween(a: CalendarDay, b: CalendarDay, shape: CalendarShape): number {
  const total = totalDaysPerYear(shape)
  const ad = ordinalDayOfYear(a, shape) + a.year * total
  const bd = ordinalDayOfYear(b, shape) + b.year * total
  return bd - ad
}

export function ordinalDayOfYear(day: CalendarDay, shape: CalendarShape): number {
  assertShape(shape)
  if (day.month < 1 || day.month > shape.monthsPerYear) {
    throw new CalendarError(`month ${day.month} out of range`)
  }
  if (day.day < 1 || day.day > shape.daysPerMonth) {
    throw new CalendarError(`day ${day.day} out of range`)
  }
  return (day.month - 1) * shape.daysPerMonth + (day.day - 1)
}

export function advanceDays(start: CalendarDay, days: number, shape: CalendarShape): CalendarDay {
  const total = totalDaysPerYear(shape)
  let absolute = start.year * total + ordinalDayOfYear(start, shape) + days
  // Normalise negative absolute days by shifting up
  let year = Math.floor(absolute / total)
  absolute -= year * total
  const month = Math.floor(absolute / shape.daysPerMonth) + 1
  const day = (absolute % shape.daysPerMonth) + 1
  return { year, month, day }
}

export function compareDays(a: CalendarDay, b: CalendarDay): number {
  if (a.year !== b.year) return a.year - b.year
  if (a.month !== b.month) return a.month - b.month
  return a.day - b.day
}

export function buildMonthGrid(
  year: number,
  month: number,
  shape: CalendarShape,
  today: CalendarDay | null = null,
): CalendarGridCell[] {
  assertShape(shape)
  if (month < 1 || month > shape.monthsPerYear) {
    throw new CalendarError(`month ${month} out of range`)
  }
  const cells: CalendarGridCell[] = []
  for (let i = 0; i < shape.daysPerMonth; i++) {
    const day = i + 1
    const isToday = !!today && today.year === year && today.month === month && today.day === day
    cells.push({
      day,
      index: i,
      isFirstOfMonth: i === 0,
      isToday,
    })
  }
  return cells
}

export interface CalendarEvent<T> {
  date: CalendarDay
  payload: T
}

export function groupEventsByDay<T>(
  events: ReadonlyArray<CalendarEvent<T>>,
  shape: CalendarShape,
  year: number,
  month: number,
): Record<number, T[]> {
  assertShape(shape)
  const out: Record<number, T[]> = {}
  for (const ev of events) {
    if (ev.date.year !== year || ev.date.month !== month) continue
    const key = ev.date.day
    if (!out[key]) out[key] = []
    out[key].push(ev.payload)
  }
  return out
}

export function formatDayShort(day: CalendarDay): string {
  return `${pad(day.month)}/${pad(day.day)}/${day.year}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
