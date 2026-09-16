export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const currentPage = Math.min(Math.max(page, 1), totalPages)
  const start = (currentPage - 1) * pageSize
  const slice = items.slice(start, start + pageSize)
  return {
    items: slice,
    page: currentPage,
    totalPages,
    total,
    start: total === 0 ? 0 : start + 1,
    end: start + slice.length,
  }
}

export function filterByQuery<T extends { label: string }>(items: T[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return items
  return items.filter((item) => item.label.toLowerCase().includes(normalized))
}
