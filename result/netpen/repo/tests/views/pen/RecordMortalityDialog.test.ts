import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecordMortalityRequest } from '@/data/api';
import type { PenView } from '@/data/projections/pen';
import type { StockEvent } from '@/domain/stock/types';
import RecordMortalityDialog from '@/views/pen/RecordMortalityDialog.vue';

import { mountView, settle } from '../../support/mount';
import { penView } from '../../support/penView';

type Record = (request: RecordMortalityRequest) => Promise<StockEvent>;

function requestFrom(mock: ReturnType<typeof vi.fn<Record>>): RecordMortalityRequest {
  const request = mock.mock.calls[0]?.[0];
  if (request === undefined) throw new Error('recordMortality was never called');
  return request;
}

async function form(
  view: PenView = penView({ number: 3, count: 50_000, meanWeightG: 4_200 }),
  recordMortality = vi.fn<Record>(() => Promise.resolve({} as StockEvent)),
) {
  const { wrapper } = await mountView(RecordMortalityDialog, {
    props: { open: true, view },
    api: { recordMortality },
  });
  await settle(wrapper, 4);
  return { wrapper, recordMortality };
}

function field(wrapper: Awaited<ReturnType<typeof form>>['wrapper'], index: number) {
  return wrapper.findAll('input[type="number"]')[index]!;
}

afterEach(() => {
  setActivePinia(undefined);
  vi.unstubAllGlobals();
});

describe('the form', () => {
  it('starts the mean weight at what the pen is carrying', async () => {
    const { wrapper } = await form();
    expect((field(wrapper, 1).element as HTMLInputElement).value).toBe('4200');
  });

  it('starts the count empty, since nobody has counted yet', async () => {
    const { wrapper } = await form();
    expect((field(wrapper, 0).element as HTMLInputElement).value).toBe('');
  });

  it('offers every cause the mort book uses', async () => {
    const { wrapper } = await form();
    const causes = wrapper.findAll('select option').map((option) => option.text());
    expect(causes).toContain('Winter ulcer');
    expect(causes).toContain('Jellyfish');
    expect(causes).toContain('Unrecorded');
  });
});

describe('what the entry means', () => {
  it('turns a count into a share of the pen, which is how it is judged', async () => {
    const { wrapper } = await form();
    await field(wrapper, 0).setValue('400');
    expect(wrapper.find('.effect').text()).toContain('0.800 %');
  });

  it('works out the biomass coming off', async () => {
    const { wrapper } = await form();
    await field(wrapper, 0).setValue('400');
    expect(wrapper.find('.effect').text()).toContain('1680 kg');
  });

  it('says what will be left standing', async () => {
    const { wrapper } = await form();
    await field(wrapper, 0).setValue('400');
    expect(wrapper.find('.effect').text()).toContain('49,600');
  });

  it('shows nothing until a count is entered', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.effect').exists()).toBe(false);
  });

  it('flags a cause that is reported separately from natural loss', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.operational').exists()).toBe(false);
    await wrapper.find('select').setValue('handling');
    expect(wrapper.find('.operational').text()).toContain('operational mortality');
  });
});

describe('what it refuses', () => {
  it('will not file more fish than the pen holds', async () => {
    const { wrapper, recordMortality } = await form();
    await field(wrapper, 0).setValue('80000');
    expect(wrapper.find('.failed').text()).toContain('more fish than the pen is carrying');

    await wrapper.find('button.control-primary').trigger('click');
    expect(recordMortality).not.toHaveBeenCalled();
  });

  it('will not file a count of nothing', async () => {
    const { wrapper, recordMortality } = await form();
    await field(wrapper, 0).setValue('0');
    await wrapper.find('button.control-primary').trigger('click');
    expect(recordMortality).not.toHaveBeenCalled();
  });
});

describe('recording', () => {
  it('sends the group, the count, the weight and the cause', async () => {
    const { wrapper, recordMortality } = await form();
    await field(wrapper, 0).setValue('250');
    await wrapper.find('select').setValue('winter-ulcer');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 6);

    const request = requestFrom(recordMortality);
    expect(request.groupId).toBe('group-1');
    expect(request.count).toBe(250);
    expect(request.meanWeightG).toBe(4_200);
    expect(request.cause).toBe('winter-ulcer');
  });

  it('tells the parent so the page can refresh', async () => {
    const { wrapper } = await form();
    await field(wrapper, 0).setValue('250');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 6);
    expect(wrapper.emitted('recorded')).toHaveLength(1);
  });

  it('says nothing was recorded when the write is refused', async () => {
    const recordMortality = vi.fn<Record>(() => Promise.reject(new Error('no')));
    const { wrapper } = await form(undefined, recordMortality);
    await field(wrapper, 0).setValue('250');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 8);
    expect(wrapper.find('.failed').text()).toContain('Nothing has been recorded');
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.emitted('recorded')).toBeUndefined();
  });

  it('asks before losing a part filled form', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { wrapper } = await form();
    await field(wrapper, 0).setValue('250');
    await wrapper.find('button.close').trigger('click');
    expect(confirm).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
