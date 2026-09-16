// Simple map plotting primitives. Coordinates are stored in arbitrary
// integer ranges and we provide normalisation onto an svg viewBox.

export interface MapCoord {
  x: number
  y: number
}

export interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function isFiniteCoord(c: MapCoord): boolean {
  return Number.isFinite(c.x) && Number.isFinite(c.y)
}

export function boundingBox(points: ReadonlyArray<MapCoord>): BoundingBox | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (!isFiniteCoord(p)) continue
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

export function paddedBox(box: BoundingBox, pad: number): BoundingBox {
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  }
}

export interface NormaliseTarget {
  width: number
  height: number
}

export function project(coord: MapCoord, box: BoundingBox, target: NormaliseTarget): MapCoord {
  const dx = box.maxX - box.minX || 1
  const dy = box.maxY - box.minY || 1
  const x = ((coord.x - box.minX) / dx) * target.width
  const y = ((coord.y - box.minY) / dy) * target.height
  return { x, y }
}

export function distance(a: MapCoord, b: MapCoord): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function manhattan(a: MapCoord, b: MapCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

export function midpoint(a: MapCoord, b: MapCoord): MapCoord {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function viewBox(box: BoundingBox): string {
  const w = box.maxX - box.minX
  const h = box.maxY - box.minY
  return `${box.minX} ${box.minY} ${w} ${h}`
}
