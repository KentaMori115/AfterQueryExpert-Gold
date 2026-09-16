import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';

import DataTable, { type Column } from '@/ui/DataTable.vue';

/**
 * The table is a generic component, and test-utils cannot infer props through
 * the generic. Widening it here keeps the cast in one place instead of at
 * every mount, and the column definitions above still carry the real types.
 */
const Table = DataTable as unknown as Component;

interface Row {
  readonly id: string;
  readonly pen: string;
  readonly lice: number;
}

const rows: Row[] = [
  { id: 'b', pen: 'Pen 3', lice: 0.18 },
  { id: 'a', pen: 'Pen 1', lice: 0.42 },
  { id: 'c', pen: 'Pen 2', lice: 0.42 },
];

const columns: Column<Row>[] = [
  { key: 'pen', header: 'Pen', sortValue: (row) => row.pen },
  { key: 'lice', header: 'Adult female', numeric: true, sortValue: (row) => row.lice },
  { key: 'note', header: 'Note' },
];

function table(overrides: Record<string, unknown> = {}) {
  return mount(Table, {
    props: {
      caption: 'Lice by pen',
      columns,
      rows,
      rowKey: (row: Row) => row.id,
      ...overrides,
    },
    slots: {
      'cell-pen': '<template #cell-pen="{ row }">{{ row.pen }}</template>',
      'cell-lice': '<template #cell-lice="{ row }">{{ row.lice.toFixed(2) }}</template>',
      'cell-note': '<template #cell-note>—</template>',
    },
  });
}

function pensInOrder(wrapper: VueWrapper): string[] {
  return wrapper.findAll('tbody tr').map((row) => row.findAll('td')[0]!.text());
}

describe('rendering', () => {
  it('renders a row per record in the order given', () => {
    expect(pensInOrder(table())).toEqual(['Pen 3', 'Pen 1', 'Pen 2']);
  });

  it('labels the table for assistive technology', () => {
    const wrapper = table();
    expect(wrapper.find('caption').text()).toBe('Lice by pen');
    expect(wrapper.find('table').attributes('aria-labelledby')).toBe(
      wrapper.find('caption').attributes('id'),
    );
  });

  it('marks the numeric columns', () => {
    const headers = table().findAll('th');
    expect(headers[1]!.classes()).toContain('numeric');
    expect(headers[0]!.classes()).not.toContain('numeric');
  });

  it('shows an empty message with no rows', () => {
    const wrapper = table({ rows: [], emptyMessage: 'No counts filed this week' });
    expect(wrapper.find('.empty').text()).toBe('No counts filed this week');
  });
});

describe('sorting', () => {
  it('says nothing about sort until a column is pressed', () => {
    for (const header of table().findAll('th')) {
      expect(header.attributes('aria-sort')).toBeUndefined();
    }
  });

  it('sorts ascending on the first press', async () => {
    const wrapper = table();
    await wrapper.findAll('th')[0]!.trigger('click');
    expect(pensInOrder(wrapper)).toEqual(['Pen 1', 'Pen 2', 'Pen 3']);
    expect(wrapper.findAll('th')[0]!.attributes('aria-sort')).toBe('ascending');
  });

  it('reverses on the second and clears on the third', async () => {
    const wrapper = table();
    const header = wrapper.findAll('th')[0]!;
    await header.trigger('click');
    await header.trigger('click');
    expect(pensInOrder(wrapper)).toEqual(['Pen 3', 'Pen 2', 'Pen 1']);
    await header.trigger('click');
    expect(pensInOrder(wrapper)).toEqual(['Pen 3', 'Pen 1', 'Pen 2']);
    expect(wrapper.findAll('th')[0]!.attributes('aria-sort')).toBeUndefined();
  });

  it('is stable, so equal rows keep the order they arrived in', async () => {
    const wrapper = table();
    await wrapper.findAll('th')[1]!.trigger('click');
    // Pen 1 and Pen 2 both read 0.42 and were supplied in that order.
    expect(pensInOrder(wrapper)).toEqual(['Pen 3', 'Pen 1', 'Pen 2']);
  });

  it('ignores a column with nothing to sort on', async () => {
    const wrapper = table();
    await wrapper.findAll('th')[2]!.trigger('click');
    expect(pensInOrder(wrapper)).toEqual(['Pen 3', 'Pen 1', 'Pen 2']);
  });

  it('honours an initial sort', () => {
    const wrapper = table({ initialSort: { key: 'lice', direction: 'desc' } });
    expect(pensInOrder(wrapper)).toEqual(['Pen 1', 'Pen 2', 'Pen 3']);
  });
});

describe('row interaction', () => {
  it('emits the row that was clicked', async () => {
    const wrapper = table();
    await wrapper.findAll('tbody tr')[0]!.trigger('click');
    expect(wrapper.emitted('rowClick')?.[0]).toEqual([rows[0]]);
  });

  it('marks the selected row', () => {
    const wrapper = table({ isSelected: (row: Row) => row.id === 'a' });
    const bodyRows = wrapper.findAll('tbody tr');
    expect(bodyRows[1]!.classes()).toContain('selected');
    expect(bodyRows[0]!.classes()).not.toContain('selected');
  });
});
