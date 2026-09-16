import { describe, expect, it } from 'vitest'

import { asTimestamp } from '../time/timestamps'

import {
  VOICE_PACES,
  VOICE_PITCHES,
  VOICE_VOLUMES,
  emptyVoice,
  summariseVoice,
  voiceProfileDraftSchema,
} from './voice-profile'

const ts = asTimestamp('2026-04-01T10:00:00Z')

describe('constants', () => {
  it('lists every option', () => {
    expect(VOICE_PITCHES.length).toBeGreaterThanOrEqual(3)
    expect(VOICE_PACES.length).toBeGreaterThanOrEqual(3)
    expect(VOICE_VOLUMES.length).toBeGreaterThanOrEqual(3)
  })
})

describe('emptyVoice', () => {
  it('returns sensible defaults', () => {
    const v = emptyVoice('char_X', ts)
    expect(v.pitch).toBe('mid')
    expect(v.pace).toBe('measured')
    expect(v.volume).toBe('normal')
  })
})

describe('summariseVoice', () => {
  it('builds a slash separated summary', () => {
    const v = emptyVoice('char_X', ts)
    expect(summariseVoice(v)).toContain('mid pitch')
  })

  it('includes catchphrase and quirk when set', () => {
    const v = { ...emptyVoice('char_X', ts), catchphrase: 'well now', quirk: 'twirls beard' }
    expect(summariseVoice(v)).toContain('catchphrase: well now')
    expect(summariseVoice(v)).toContain('quirk: twirls beard')
  })

  it('omits accent line when empty', () => {
    expect(summariseVoice(emptyVoice('char_X', ts))).not.toContain('accent:')
  })
})

describe('voiceProfileDraftSchema', () => {
  it('accepts a minimal draft', () => {
    expect(voiceProfileDraftSchema.safeParse({ characterId: 'char_X' }).success).toBe(true)
  })

  it('rejects an unknown pitch', () => {
    expect(
      voiceProfileDraftSchema.safeParse({ characterId: 'char_X', pitch: 'shrill' }).success,
    ).toBe(false)
  })

  it('rejects long catchphrases', () => {
    expect(
      voiceProfileDraftSchema.safeParse({
        characterId: 'char_X',
        catchphrase: 'x'.repeat(400),
      }).success,
    ).toBe(false)
  })
})
