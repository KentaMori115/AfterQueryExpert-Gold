import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecordTreatmentRequest } from '@/data/api';
import type { PenView } from '@/data/projections/pen';
import type { TreatmentEvent } from '@/domain/health/treatment';
import RecordTreatmentDialog from '@/views/pen/RecordTreatmentDialog.vue';

import { mountView, settle } from '../../support/mount';
import { penView } from '../../support/penView';

type Record = (request: RecordTreatmentRequest) => Promise<TreatmentEvent>;

function requestFrom(mock: ReturnType<typeof vi.fn<Record>>): RecordTreatmentRequest {
  const request = mock.mock.calls[0]?.[0];
  if (request === undefined) throw new Error('recordTreatment was never called');
  return request;
}

async function form(
  view: PenView = penView({ number: 3, adultFemale: 0.62 }),
  recordTreatment = vi.fn<Record>(() => Promise.resolve({} as TreatmentEvent)),
) {
  const { wrapper } = await mountView(RecordTreatmentDialog, {
    props: { open: true, view },
    api: { recordTreatment },
  });
  await settle(wrapper, 4);
  return { wrapper, recordTreatment };
}

afterEach(() => {
  setActivePinia(undefined);
  vi.unstubAllGlobals();
});

describe('the form', () => {
  it('names the pen it is recording against', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.subtitle').text()).toBe('Pen 3');
  });

  it('offers every method the site can use', async () => {
    const { wrapper } = await form();
    const options = wrapper.findAll('select option').map((option) => option.text());
    expect(options).toContain('Emamectin benzoate in feed');
    expect(options.length).toBeGreaterThan(5);
  });

  it('starts the before count at the last figure somebody filed', async () => {
    const { wrapper } = await form();
    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe('0.62');
  });

  it('leaves the before count empty where nothing has been counted', async () => {
    const { wrapper } = await form(penView({ adultFemale: null }));
    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe('');
  });
});

describe('what the method costs', () => {
  it('says a mechanical method has no withdrawal', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.consequences').text()).toContain('None, harvest unaffected');
  });

  it('warns about the withdrawal an in feed method starts', async () => {
    const { wrapper } = await form();
    await wrapper.find('select').setValue('emamectin-benzoate');
    expect(wrapper.find('dd.heavy').text()).toBe('175 degree days');
  });

  it('says whether the pen has to be crowded, since that is a boat and a day', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.consequences').text()).toContain('Crowds the pen');

    await wrapper.find('select').setValue('emamectin-benzoate');
    expect(wrapper.find('.consequences').text()).toContain('No crowd needed');
  });

  it('gives the reduction the method usually achieves', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.consequences').text()).toMatch(/\d+ %/);
  });
});

describe('what to expect afterwards', () => {
  it('works out where the count should land', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.expected').text()).toMatch(/about 0\.\d\d adult female/);
  });

  it('says nothing when there is no before count to work from', async () => {
    const { wrapper } = await form(penView({ adultFemale: null }));
    expect(wrapper.find('.expected').exists()).toBe(false);
  });

  it('moves with the method, since the reduction differs', async () => {
    const { wrapper } = await form();
    const thermal = wrapper.find('.expected').text();
    await wrapper.find('select').setValue('emamectin-benzoate');
    expect(wrapper.find('.expected').text()).not.toBe(thermal);
  });
});

describe('a pen already inside a withdrawal', () => {
  it('says another medicinal treatment extends it', async () => {
    const { wrapper } = await form(penView({ withdrawalRemaining: 80, blocking: true }));
    expect(wrapper.find('.blocked').text()).toContain('extends it');
  });

  it('says nothing on a pen that is clear', async () => {
    const { wrapper } = await form();
    expect(wrapper.find('.blocked').exists()).toBe(false);
  });
});

describe('recording', () => {
  it('sends the method, the before count and the instant', async () => {
    const { wrapper, recordTreatment } = await form();
    await wrapper.find('select').setValue('freshwater');
    await wrapper.find('input[type="text"]').setValue('Wellboat, two hours');
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 6);

    const request = requestFrom(recordTreatment);
    expect(request.penId).toBe('pen-3');
    expect(request.method).toBe('freshwater');
    expect(request.beforeCount).toBe(0.62);
    expect(request.note).toBe('Wellboat, two hours');
  });

  it('tells the parent, so the pen page can refresh', async () => {
    const { wrapper } = await form();
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 6);
    expect(wrapper.emitted('recorded')).toHaveLength(1);
  });

  it('says nothing was recorded when the write is refused', async () => {
    const recordTreatment = vi.fn<Record>(() => Promise.reject(new Error('no')));
    const { wrapper } = await form(penView({ number: 3 }), recordTreatment);
    await wrapper.find('button.control-primary').trigger('click');
    await settle(wrapper, 8);
    expect(wrapper.find('.failed').text()).toContain('Nothing has been recorded');
  });

  it('asks before losing a part filled form', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { wrapper } = await form();
    await wrapper.find('button.close').trigger('click');
    expect(confirm).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
