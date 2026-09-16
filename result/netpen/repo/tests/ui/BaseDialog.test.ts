import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import BaseDialog from '@/ui/BaseDialog.vue';

/**
 * jsdom knows the dialog element but not the top layer, so showModal exists
 * and does very little. That is enough: what is being tested here is the open
 * state, the guard and the events, not the browser's rendering of a backdrop.
 */
/** The watcher awaits a tick of its own before touching the element. */
async function flush(wrapper: ReturnType<typeof dialog>): Promise<void> {
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
}

function dialog(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(BaseDialog, {
    props: { open: true, title: 'Record a lice count', ...props },
    slots: { default: '<p class="content">Twenty fish</p>', ...slots },
    attachTo: document.body,
  });
}

describe('opening and closing', () => {
  it('opens the element when the prop says so', async () => {
    const wrapper = dialog();
    await flush(wrapper);
    expect(wrapper.find('dialog').element.open).toBe(true);
  });

  it('stays shut until it is asked to open', async () => {
    const wrapper = dialog({ open: false });
    await flush(wrapper);
    expect(wrapper.find('dialog').element.open).toBe(false);
  });

  it('closes the element when the prop goes false', async () => {
    const wrapper = dialog();
    await flush(wrapper);
    await wrapper.setProps({ open: false });
    await flush(wrapper);
    expect(wrapper.find('dialog').element.open).toBe(false);
  });
});

describe('the close button', () => {
  it('asks the parent to close rather than closing itself', async () => {
    const wrapper = dialog();
    await wrapper.find('button.close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('carries a label, since it is an icon', () => {
    expect(dialog().find('button.close').attributes('aria-label')).toBe('Close');
  });
});

describe('the guard', () => {
  it('lets a form refuse to be closed', async () => {
    const beforeClose = vi.fn(() => false);
    const wrapper = dialog({ beforeClose });
    await wrapper.find('button.close').trigger('click');
    expect(beforeClose).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('closes when the guard is happy', async () => {
    const wrapper = dialog({ beforeClose: () => true });
    await wrapper.find('button.close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('sends escape through the same guard rather than letting the browser win', async () => {
    const beforeClose = vi.fn(() => false);
    const wrapper = dialog({ beforeClose });
    await wrapper.vm.$nextTick();

    const event = new Event('cancel', { cancelable: true });
    wrapper.find('dialog').element.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(beforeClose).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});

describe('the frame', () => {
  it('names itself for a screen reader', async () => {
    const wrapper = dialog();
    const labelled = wrapper.find('dialog').attributes('aria-labelledby');
    expect(wrapper.find(`#${labelled}`).text()).toBe('Record a lice count');
  });

  it('shows a subtitle only when it has one', () => {
    expect(dialog().find('.subtitle').exists()).toBe(false);
    expect(dialog({ subtitle: 'Pen 3' }).find('.subtitle').text()).toBe('Pen 3');
  });

  it('renders what it was given', () => {
    expect(dialog().find('.content').text()).toBe('Twenty fish');
  });

  it('leaves the footer out when nothing was put in it', () => {
    expect(dialog().find('footer').exists()).toBe(false);
    const withActions = dialog({}, { actions: '<button class="save">Save</button>' });
    expect(withActions.find('footer .save').exists()).toBe(true);
  });

  it('hands the actions slot a way to close through the guard', async () => {
    const wrapper = dialog(
      { beforeClose: () => true },
      { actions: '<template #actions="{ close }"><button class="x" @click="close" /></template>' },
    );
    await wrapper.find('button.x').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
