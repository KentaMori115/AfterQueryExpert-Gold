export type Ranked<T> = {
  rank: number
  tie: number
  value: T
}

export function siftUp(items: Ranked<unknown>[], index: number) {
  let current = index
  while (current > 0) {
    const parent = Math.floor((current - 1) / 2)
    if (compare(items[current], items[parent]) >= 0) break
    swap(items, current, parent)
    current = parent
  }
}

export function siftDown(items: Ranked<unknown>[], index: number) {
  let current = index
  while (true) {
    const left = current * 2 + 1
    const right = left + 1
    let smallest = current
    if (left < items.length && compare(items[left], items[smallest]) < 0) {
      smallest = left
    }
    if (right < items.length && compare(items[right], items[smallest]) < 0) {
      smallest = right
    }
    if (smallest === current) break
    swap(items, current, smallest)
    current = smallest
  }
}

function compare(a: Ranked<unknown>, b: Ranked<unknown>) {
  if (a.rank !== b.rank) return a.rank - b.rank
  return a.tie - b.tie
}

function swap(items: Ranked<unknown>[], i: number, j: number) {
  const tmp = items[i]
  items[i] = items[j]
  items[j] = tmp
}
