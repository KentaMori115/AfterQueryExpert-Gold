import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecordCountRequest } from '@/data/api';
import type { LiceCount } from '@/data/fixtures/lice';
import type { Person } from '@/data/fixtures/site';
import RecordCountDialog from '@/views/lice/RecordCountDialog.vue';

import { mountView, settle } from '../../support/mount';

const PEOPLE = [
  { id: 'per-tait', name: 'A. Tait' },
  { id: 'per-lamont', name: 'R. Lamont' },
] as unknown as Person[];

type RecordCount = (request: RecordCountRequest) => Promise<LiceCount>;

/** Narrowed once here, so the assertions below do not each cast the call. */
function requestFrom(mock: ReturnType<typeof vi.fn<RecordCount>>, call = 0): RecordCountRequest {
  const request = mock.mock.calls[call]?.[0];
  if (request === undefined) throw new Error('recordCount was never called');
  return request;
}

async function form(recordCount = vi.fn<RecordCount>(() => Promise.resolve({} as LiceCount))) {
  const { wrapper } = await mountView(RecordCountDialog, {
    props: { open: true, penId: 'pen-3', penNumber: 3 },
    api: { listPeople: () => Promise.resolve(PEOPLE), recordCount },
  });
  await settle(wrapper, 6);
  return { wrapper, recordCount };
}

afterEach(() => {
  setActivePinia(undefined);
  vi.unstubAllGlobals();
});

describe('the form', () => {
  it('names the pen it is filing against', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.subtitle').text()).toBe('Pen 3');
  });

  it('opens on an empty sample of the size the regime asks for', async () => {
    const { wrapper } = await form();
    const boxes = wrapper.findAll('tbody tr:first-child input');
    expect(boxes).toHaveLength(20);
    expect(boxes.every((box) => (box.element as HTMLInputElement).value === '0')).toBe(true);
  });

  it('lists the people who could have counted', async () => {
    const { wrapper } = await form();
    const names = wrapper.findAll('select option').map((option) => option.text());
    expect(names).toContain('A. Tait');
    expect(names).toContain('R. Lamont');
  });

  it('says what it is about to file, in the units the register uses', async () => {
    const { wrapper } = await form();
    await wrapper.findAll('tbody tr:first-child input')[0]!.setValue('4');
    await wrapper.findAll('tbody tr:first-child input')[1]!.setValue('6');
    expect(wrapper.find('.summary').text()).toContain('0.50 adult female per fish');
  });
});

describe('what it refuses to file', () => {
  it('will not file without a name against it', async () => {
    const { wrapper, recordCount } = await form();
    await wrapper.find('tbody input').setValue('2');
    expect(wrapper.find('.problems').text()).toContain('Say who counted');

    await wrapper.find('button.control-primary').trigger('click');
    expect(recordCount).not.toHaveBeenCalled();
  });

  it('refuses a sea temperature this water never reaches', async () => {
    const { wrapper } = await form();
    await wrapper.find('tbody input').setValue('2');
    await wrapper.find('select').setValue('per-tait');
    await wrapper.find('input[type="number"][step="0.1"]').setValue('54');
    expect(wrapper.find('.problems').text()).toContain('not a temperature');
  });

  it('stays quiet about problems until something has been entered', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.problems').exists()).toBe(false);
  });
});

describe('filing', () => {
  it('sends the sample, the counter and the instant', async () => {
    const { wrapper, recordCount } = await form();
    await wrapper.findAll('tbody tr:first-child input')[0]!.setValue('3');
    await wrapper.find('select').setValue('per-tait');
    await wrapper.find('input[type="number"][step="0.1"]').setValue('9.6');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 6);

    expect(recordCount).toHaveBeenCalledTimes(1);
    const request = requestFrom(recordCount);
    expect(request.penId).toBe('pen-3');
    expect(request.countedBy).toBe('per-tait');
    expect(request.seaTemperatureC).toBe(9.6);
    expect(request.sample[0]!.adultFemale).toBe(3);
  });

  it('sends no temperature rather than a zero when none was read', async () => {
    const { wrapper, recordCount } = await form();
    await wrapper.find('select').setValue('per-tait');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 6);
    expect(requestFrom(recordCount).seaTemperatureC).toBeNull();
  });

  it('tells the parent it is done, so the register can refresh', async () => {
    const { wrapper } = await form();
    await wrapper.find('select').setValue('per-tait');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 6);
    expect(wrapper.emitted('filed')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('says nothing was filed when the write is refused, so it can be sent again', async () => {
    const recordCount = vi.fn<RecordCount>(() => Promise.reject(new Error('refused')));
    const { wrapper } = await form(recordCount);
    await wrapper.find('select').setValue('per-tait');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 8);

    expect(wrapper.find('.failed').text()).toContain('Nothing has been filed');
    expect(wrapper.emitted('filed')).toBeUndefined();
  });

  it('stays open after a refusal, with the count still in it', async () => {
    const recordCount = vi.fn<RecordCount>(() => Promise.reject(new Error('refused')));
    const { wrapper } = await form(recordCount);
    await wrapper.findAll('tbody tr:first-child input')[0]!.setValue('4');
    await wrapper.find('select').setValue('per-tait');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 8);

    expect(wrapper.emitted('close')).toBeUndefined();
    const first = wrapper.findAll('tbody tr:first-child input')[0]!.element as HTMLInputElement;
    expect(first.value).toBe('4');
  });

  it('lets the same count be sent again once the link comes back', async () => {
    let refuse = true;
    const recordCount = vi.fn<RecordCount>(() =>
      refuse ? Promise.reject(new Error('refused')) : Promise.resolve({} as LiceCount),
    );
    const { wrapper } = await form(recordCount);
    await wrapper.find('select').setValue('per-tait');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 8);

    refuse = false;
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 8);

    expect(recordCount).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted('filed')).toHaveLength(1);
  });
});

describe('closing', () => {
  it('closes without asking when nothing has been entered', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const { wrapper } = await form();
    await wrapper.find('button.close').trigger('click');
    expect(confirm).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('asks before losing a part entered count', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { wrapper } = await form();
    await wrapper.find('tbody input').setValue('5');
    await wrapper.find('button.close').trigger('click');

    expect(confirm).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
