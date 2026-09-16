<script setup lang="ts" generic="T">
import { computed, ref, useId } from 'vue';

/**
 * A table.
 *
 * Sorting is held here rather than lifted, because every table in the
 * application sorts the same way and none of them need the state anywhere
 * else. The sort is stable: rows comparing equal keep the order the caller
 * gave them, which matters because the caller has usually already ordered them
 * by something meaningful, such as pen number.
 */

export interface Column<Row> {
  readonly key: string;
  readonly header: string;
  /** Right aligned and tabular. Use for anything the eye compares down a column. */
  readonly numeric?: boolean;
  /** Supplying this makes the column sortable. */
  readonly sortValue?: (row: Row) => number | string;
  readonly width?: string;
}

export type SortDirection = 'asc' | 'desc';

const props = withDefaults(
  defineProps<{
    readonly columns: readonly Column<T>[];
    readonly rows: readonly T[];
    readonly rowKey: (row: T) => string;
    readonly caption: string;
    readonly emptyMessage?: string;
    readonly compact?: boolean;
    readonly isSelected?: (row: T) => boolean;
    readonly initialSort?: { readonly key: string; readonly direction: SortDirection };
  }>(),
  {
    emptyMessage: 'Nothing to show',
    compact: false,
    isSelected: undefined,
    initialSort: undefined,
  },
);

const emit = defineEmits<{ rowClick: [row: T] }>();

const captionId = useId();
const sort = ref<{ key: string; direction: SortDirection } | null>(props.initialSort ?? null);

function compare(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}

const ordered = computed(() => {
  const current = sort.value;
  if (current === null) return props.rows;

  const column = props.columns.find((candidate) => candidate.key === current.key);
  if (!column?.sortValue) return props.rows;
  const extract = column.sortValue;

  return props.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const result = compare(extract(a.row), extract(b.row));
      if (result !== 0) return current.direction === 'asc' ? result : -result;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
});

function toggleSort(key: string): void {
  const current = sort.value;
  if (current === null || current.key !== key) sort.value = { key, direction: 'asc' };
  else if (current.direction === 'asc') sort.value = { key, direction: 'desc' };
  else sort.value = null;
}

function ariaSort(key: string): 'ascending' | 'descending' | undefined {
  if (sort.value?.key !== key) return undefined;
  return sort.value.direction === 'asc' ? 'ascending' : 'descending';
}
</script>

<template>
  <div class="scroller">
    <table :class="{ compact }" :aria-labelledby="captionId">
      <caption :id="captionId" class="sr-only">
        {{
          caption
        }}
      </caption>
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            :style="column.width === undefined ? undefined : { width: column.width }"
            :class="{ numeric: column.numeric, sortable: column.sortValue !== undefined }"
            :aria-sort="ariaSort(column.key)"
            @click="column.sortValue !== undefined && toggleSort(column.key)"
          >
            {{ column.header }}
            <span v-if="ariaSort(column.key) !== undefined" class="mark" aria-hidden="true">{{
              sort?.direction === 'asc' ? '▲' : '▼'
            }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="ordered.length === 0">
          <td class="empty" :colspan="columns.length">{{ emptyMessage }}</td>
        </tr>
        <tr
          v-for="row in ordered"
          v-else
          :key="rowKey(row)"
          :class="{ selected: isSelected?.(row) }"
          @click="emit('rowClick', row)"
        >
          <td v-for="column in columns" :key="column.key" :class="{ numeric: column.numeric }">
            <slot :name="`cell-${column.key}`" :row="row">{{ '' }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scroller {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--type-sm);
}

th,
td {
  padding: var(--gap-2) var(--gap-4);
  text-align: left;
  border-bottom: 1px solid var(--rule-hair);
  vertical-align: middle;
}

thead th {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  background: var(--surface-sunken);
  font-size: var(--type-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ink-secondary);
  white-space: nowrap;
}

.numeric {
  text-align: right;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}

.sortable {
  cursor: pointer;
  user-select: none;
}

.sortable:hover {
  color: var(--ink-primary);
}

.mark {
  margin-left: var(--gap-1);
  opacity: 0.7;
}

tbody tr:hover td {
  background: var(--surface-sunken);
}

.selected td {
  background: var(--accent-wash);
}

.empty {
  padding: var(--gap-6);
  text-align: center;
  color: var(--ink-muted);
}

.compact th,
.compact td {
  padding: var(--gap-1) var(--gap-3);
}
</style>
