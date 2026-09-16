import { z } from 'zod'

import type { ISOTimestamp } from '../time/timestamps'

export type VoicePitch = 'high' | 'mid' | 'low' | 'gravelly'
export type VoicePace = 'slow' | 'measured' | 'quick' | 'staccato'
export type VoiceVolume = 'whisper' | 'soft' | 'normal' | 'loud'

export const VOICE_PITCHES: ReadonlyArray<VoicePitch> = ['high', 'mid', 'low', 'gravelly']
export const VOICE_PACES: ReadonlyArray<VoicePace> = ['slow', 'measured', 'quick', 'staccato']
export const VOICE_VOLUMES: ReadonlyArray<VoiceVolume> = ['whisper', 'soft', 'normal', 'loud']

export interface VoiceProfile {
  characterId: string
  pitch: VoicePitch
  pace: VoicePace
  volume: VoiceVolume
  catchphrase: string
  quirk: string
  accent: string
  updatedAt: ISOTimestamp
}

export interface VoiceProfileDraft {
  characterId: string
  pitch?: VoicePitch
  pace?: VoicePace
  volume?: VoiceVolume
  catchphrase?: string
  quirk?: string
  accent?: string
}

export const voiceProfileDraftSchema = z.object({
  characterId: z.string().min(1),
  pitch: z.enum(VOICE_PITCHES as unknown as [VoicePitch, ...VoicePitch[]]).optional(),
  pace: z.enum(VOICE_PACES as unknown as [VoicePace, ...VoicePace[]]).optional(),
  volume: z.enum(VOICE_VOLUMES as unknown as [VoiceVolume, ...VoiceVolume[]]).optional(),
  catchphrase: z.string().max(240).optional(),
  quirk: z.string().max(240).optional(),
  accent: z.string().max(80).optional(),
})

export function summariseVoice(profile: VoiceProfile): string {
  const bits: string[] = []
  bits.push(`${profile.pitch} pitch, ${profile.pace} pace, ${profile.volume} volume`)
  if (profile.accent) bits.push(`accent: ${profile.accent}`)
  if (profile.catchphrase) bits.push(`catchphrase: ${profile.catchphrase}`)
  if (profile.quirk) bits.push(`quirk: ${profile.quirk}`)
  return bits.join(' / ')
}

export function emptyVoice(characterId: string, updatedAt: ISOTimestamp): VoiceProfile {
  return {
    characterId,
    pitch: 'mid',
    pace: 'measured',
    volume: 'normal',
    catchphrase: '',
    quirk: '',
    accent: '',
    updatedAt,
  }
}
