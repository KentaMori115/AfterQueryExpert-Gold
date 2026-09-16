<script setup lang="ts">
import { computed } from 'vue'

import type { CharacterId, FactionId } from '@core/ids'
import {
  type Relationship,
  endpointsMatch,
  intensityWidth,
  kindLabel,
  kindTone,
} from '@core/models/relationship'

interface NamedNode {
  kind: 'character' | 'faction'
  id: string
  label: string
}

const props = defineProps<{
  relationships: ReadonlyArray<Relationship>
  characters: ReadonlyArray<{ id: CharacterId; name: string }>
  factions: ReadonlyArray<{ id: FactionId; name: string }>
  width?: number
  height?: number
}>()

const w = computed(() => props.width ?? 600)
const h = computed(() => props.height ?? 360)

const nodes = computed<NamedNode[]>(() => {
  const seen = new Map<string, NamedNode>()
  function key(n: NamedNode): string {
    return `${n.kind}:${n.id}`
  }
  function add(n: NamedNode): void {
    if (!seen.has(key(n))) seen.set(key(n), n)
  }
  for (const r of props.relationships) {
    const fromLabel =
      r.from.kind === 'character'
        ? props.characters.find((c) => c.id === r.from.id)?.name
        : props.factions.find((f) => f.id === r.from.id)?.name
    const toLabel =
      r.to.kind === 'character'
        ? props.characters.find((c) => c.id === r.to.id)?.name
        : props.factions.find((f) => f.id === r.to.id)?.name
    add({ kind: r.from.kind, id: r.from.id, label: fromLabel ?? 'unknown' })
    add({ kind: r.to.kind, id: r.to.id, label: toLabel ?? 'unknown' })
  }
  return Array.from(seen.values())
})

const positions = computed(() => {
  const cx = w.value / 2
  const cy = h.value / 2
  const radius = Math.min(cx, cy) - 40
  const out = new Map<string, { x: number; y: number }>()
  const count = nodes.value.length
  if (count === 0) return out
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const node = nodes.value[i]!
    out.set(`${node.kind}:${node.id}`, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    })
  }
  return out
})

function positionOf(node: { kind: string; id: string }): { x: number; y: number } | null {
  return positions.value.get(`${node.kind}:${node.id}`) ?? null
}

function strokeColor(rel: Relationship): string {
  switch (kindTone(rel.kind)) {
    case 'success':
      return '#62844a'
    case 'warning':
      return '#e1581a'
    case 'danger':
      return '#b73a44'
    case 'info':
      return '#534f44'
    default:
      return '#a8a59a'
  }
}

function nodeFill(node: NamedNode, hasEdges: boolean): string {
  if (!hasEdges) return '#e7e6e3'
  return node.kind === 'character' ? '#fbf7ee' : '#fdc28d'
}

const edgesWithPositions = computed(() =>
  props.relationships
    .map((r) => {
      const a = positionOf(r.from)
      const b = positionOf(r.to)
      if (!a || !b) return null
      return { rel: r, a, b }
    })
    .filter((x): x is { rel: Relationship; a: { x: number; y: number }; b: { x: number; y: number } } => x !== null),
)

function involves(node: NamedNode): boolean {
  return props.relationships.some((r) => endpointsMatch(r.from, node as never) || endpointsMatch(r.to, node as never))
}
</script>

<template>
  <div class="surface p-2 overflow-x-auto">
    <svg
      :viewBox="`0 0 ${w} ${h}`"
      :width="w"
      :height="h"
      role="img"
      aria-label="Relationship graph"
      class="block max-w-full"
    >
      <g stroke-linecap="round">
        <line
          v-for="(edge, i) in edgesWithPositions"
          :key="i"
          :x1="edge.a.x"
          :y1="edge.a.y"
          :x2="edge.b.x"
          :y2="edge.b.y"
          :stroke="strokeColor(edge.rel)"
          :stroke-width="Math.max(1, intensityWidth(edge.rel.intensity) / 25)"
          opacity="0.7"
        >
          <title>{{ kindLabel(edge.rel.kind) }} ({{ edge.rel.intensity }}/5)</title>
        </line>
      </g>
      <g>
        <template v-for="node in nodes" :key="node.kind + ':' + node.id">
          <g v-if="positionOf(node)">
            <circle
              :cx="positionOf(node)!.x"
              :cy="positionOf(node)!.y"
              :r="node.kind === 'character' ? 14 : 18"
              :fill="nodeFill(node, involves(node))"
              stroke="#3f2f17"
              stroke-width="1"
            />
            <text
              :x="positionOf(node)!.x"
              :y="positionOf(node)!.y + 28"
              text-anchor="middle"
              font-size="11"
              fill="#3f2f17"
            >
              {{ node.label }}
            </text>
          </g>
        </template>
      </g>
    </svg>
    <p v-if="nodes.length === 0" class="text-sm text-ink-500 p-4 text-center">
      No relationships to draw yet.
    </p>
  </div>
</template>
