import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids'

import NoteComposer from './NoteComposer.vue'

const target = { kind: 'character' as const, id: asCharacterId('char_A') }

describe('NoteComposer', () => {
  it('rejects empty body', async () => {
    const w = mount(NoteComposer, {
      props: { campaignId: 'camp_X', target },
    })
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
    expect(w.text().toLowerCase()).toContain('required')
  })

  it('emits submit with parsed payload', async () => {
    const w = mount(NoteComposer, {
      props: { campaignId: 'camp_X', target },
    })
    await w.get('#note-body').setValue('Watch the candles')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    const ev = w.emitted('submit')
    expect(ev).toHaveLength(1)
    const payload = ev?.[0]?.[0] as { body: string; target: typeof target; priority: string }
    expect(payload.body).toBe('Watch the candles')
    expect(payload.target.id).toBe(target.id)
    expect(payload.priority).toBe('normal')
  })

  it('emits null remindAt when blank', async () => {
    const w = mount(NoteComposer, {
      props: { campaignId: 'camp_X', target },
    })
    await w.get('#note-body').setValue('something')
    await w.find('form').trigger('submit.prevent')
    const payload = (w.emitted('submit')?.[0]?.[0] ?? {}) as { remindAt: string | null }
    expect(payload.remindAt).toBe(null)
  })

  it('seeds fields from initial', () => {
    const w = mount(NoteComposer, {
      props: {
        campaignId: 'camp_X',
        target,
        initial: { body: 'preloaded', priority: 'critical' },
      },
    })
    expect((w.get('#note-body').element as HTMLTextAreaElement).value).toBe('preloaded')
    expect((w.get('#note-priority').element as HTMLSelectElement).value).toBe('critical')
  })

  it('emits cancel on cancel click', async () => {
    const w = mount(NoteComposer, {
      props: { campaignId: 'camp_X', target },
    })
    const cancel = w.findAll('button').find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})
