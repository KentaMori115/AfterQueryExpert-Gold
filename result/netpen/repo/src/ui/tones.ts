/**
 * Tone mapping.
 *
 * One place decides what colour a state is, so the whole interface agrees. A
 * lice status that reads amber on the board and red on the pen page destroys
 * trust in both, and that divergence happens the moment two components each
 * decide for themselves.
 */

import type { AlertSeverity } from '@/domain/alerts/types';
import type { DensityStatus } from '@/domain/biomass/standing';
import type { FcrBand } from '@/domain/feed/conversion';
import type { MortalityLevel } from '@/domain/health/mortality';
import type { LiceStatus } from '@/domain/lice/thresholds';
import type { OxygenBand } from '@/domain/water/oxygen';

export type Tone = 'neutral' | 'info' | 'good' | 'caution' | 'bad';

export function toneForSeverity(severity: AlertSeverity): Tone {
  if (severity === 'urgent') return 'bad';
  if (severity === 'warning') return 'caution';
  return 'info';
}

export function toneForLice(status: LiceStatus): Tone {
  switch (status) {
    case 'clear':
      return 'good';
    case 'approaching':
      return 'caution';
    default:
      return 'bad';
  }
}

export function toneForOxygen(band: OxygenBand): Tone {
  switch (band) {
    case 'good':
      return 'good';
    case 'reduced':
      return 'caution';
    case 'supersaturated':
      return 'caution';
    default:
      return 'bad';
  }
}

export function toneForDensity(status: DensityStatus): Tone {
  switch (status) {
    case 'comfortable':
      return 'good';
    case 'watch':
      return 'caution';
    default:
      return 'bad';
  }
}

export function toneForMortality(level: MortalityLevel): Tone {
  switch (level) {
    case 'normal':
      return 'good';
    case 'elevated':
      return 'caution';
    case 'incident':
      return 'bad';
    default:
      return 'neutral';
  }
}

export function toneForFcr(band: FcrBand): Tone {
  switch (band) {
    case 'good':
      return 'good';
    case 'acceptable':
      return 'caution';
    case 'poor':
      return 'bad';
    default:
      return 'neutral';
  }
}

/**
 * Progress toward a limit. Note the direction: for a lice count or a biomass
 * ceiling, more is worse, which is the opposite of a progress bar toward a
 * target and the reason this is a separate function.
 */
export function toneForUtilisation(fraction: number): Tone {
  if (!Number.isFinite(fraction)) return 'neutral';
  if (fraction > 1) return 'bad';
  if (fraction >= 0.88) return 'caution';
  return 'good';
}
