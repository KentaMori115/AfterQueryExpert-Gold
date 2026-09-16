export interface PageRequest {
  page: number
  perPage: number
}

export interface PageInfo {
  page: number
  perPage: number
  total: number
  totalPages: number
}

export function paginate<T>(rows: readonly T[], req: PageRequest): T[] {
  const perPage = Math.max(1, Math.floor(req.perPage))
  const page = Math.max(0, Math.floor(req.page))
  const start = page * perPage
  return rows.slice(start, start + perPage)
}

export function pageInfoOf(total: number, req: PageRequest): PageInfo {
  const perPage = Math.max(1, Math.floor(req.perPage))
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage)
  const page = clampPage(Math.floor(req.page), totalPages)
  return { page, perPage, total, totalPages }
}

function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 0
  if (page < 0) return 0
  if (page >= totalPages) return Math.max(0, totalPages - 1)
  return page
}

export function pageWindow(info: PageInfo, span = 5): number[] {
  if (info.totalPages <= 1) return []
  const half = Math.floor(span / 2)
  let start = Math.max(0, info.page - half)
  let end = start + span
  if (end > info.totalPages) {
    end = info.totalPages
    start = Math.max(0, end - span)
  }
  const out: number[] = []
  for (let i = start; i < end; i++) out.push(i)
  return out
}
