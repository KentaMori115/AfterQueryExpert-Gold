/* eslint-disable vue/one-component-per-file -- Two throwaway components:
   a child that fails on demand and a host to put it under. Splitting them
   into files of their own would hide what the test is doing. */
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import { APP_VERSION } from '@/app/version';
import ErrorBoundary from '@/ui/ErrorBoundary.vue';

import { mountView } from '../support/mount';

/** A child that throws while rendering, on demand. */
const Fragile = defineComponent({
  props: { broken: { type: Boolean, default: true } },
  setup(props) {
    return () => {
      if (props.broken) throw new Error('Cannot read the pen geometry of null');
      return h('p', { class: 'fine' }, 'Pen 3');
    };
  },
});

async function boundary(options: { broken?: boolean; report?: (error: unknown) => void } = {}) {
  const broken = ref(options.broken ?? true);
  const host = defineComponent({
    setup() {
      return () =>
        h(
          ErrorBoundary,
          { report: options.report ?? null },
          { default: () => h(Fragile, { broken: broken.value }) },
        );
    },
  });

  const { wrapper, router } = await mountView(host, { path: '/pens/pen-3' });
  return { wrapper, router, broken };
}

describe('when a screen throws', () => {
  it('shows the failure rather than a blank page', async () => {
    const { wrapper } = await boundary();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('h2').text()).toBe('This screen stopped');
  });

  it('quotes the message, since somebody has to relay it down a phone', async () => {
    const { wrapper } = await boundary();
    expect(wrapper.find('.detail').text()).toBe('Cannot read the pen geometry of null');
  });

  it('says where it happened and which build it was', async () => {
    const { wrapper } = await boundary();
    expect(wrapper.find('.where').text()).toContain('/pens/pen-3');
    expect(wrapper.find('.where').text()).toContain(APP_VERSION);
  });

  it('says the failure goes nowhere when there is nothing to report it to', async () => {
    const { wrapper } = await boundary();
    expect(wrapper.find('.where').text()).toContain('worth writing down');
  });

  it('hands the failure to a reporter where one is given', async () => {
    const report = vi.fn();
    const { wrapper } = await boundary({ report });
    expect(report).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.where').text()).not.toContain('worth writing down');
  });

  it('says the rest of the application is still working, because it is', async () => {
    const { wrapper } = await boundary();
    expect(wrapper.find('.what').text()).toContain('rest of the application is still working');
  });
});

describe('getting out of it', () => {
  it('renders the screen again when asked to retry', async () => {
    const { wrapper, broken } = await boundary();
    broken.value = false;
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('.fine').text()).toBe('Pen 3');
  });

  it('clears itself when the route moves on', async () => {
    const { wrapper, router, broken } = await boundary();
    broken.value = false;
    await router.push('/pens');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});

describe('when nothing is wrong', () => {
  it('renders what it was given and nothing of its own', async () => {
    const { wrapper } = await boundary({ broken: false });
    expect(wrapper.find('.fine').text()).toBe('Pen 3');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
