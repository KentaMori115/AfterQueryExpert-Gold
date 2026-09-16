/**
 * Wire schemas for the things that change daily: stock events, lice counts,
 * treatments and harvests.
 *
 * Kept apart from the site schemas because these are the ones that move. The
 * counting app adds a field most releases and the site tree changes twice a
 * year, so a schema change here should not touch the file the pen list parses
 * through.
 */

import { z } from 'zod';

import { instant, nullableInstant } from './schemas';

export const stockEventSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  at: instant,
  kind: z.enum([
    'stocked',
    'mortality',
    'harvested',
    'transferred-in',
    'transferred-out',
    'escape',
    'count-adjustment',
    'weighed',
  ]),
  countDelta: z.number().int(),
  meanWeightG: z.number().positive().nullable(),
  note: z.string(),
});

export const fishCountSchema = z.object({
  chalimus: z.number().int().nonnegative(),
  preAdult: z.number().int().nonnegative(),
  adultMale: z.number().int().nonnegative(),
  adultFemale: z.number().int().nonnegative(),
  caligus: z.number().int().nonnegative(),
});

export const liceCountSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  penId: z.string().min(1),
  countedAt: instant,
  countedBy: z.string(),
  /** One entry per fish examined. Twenty is the usual sample. */
  sample: z.array(fishCountSchema).min(1),
  seaTemperatureC: z.number().nullable(),
  note: z.string(),
});

export const treatmentSchema = z.object({
  id: z.string().min(1),
  penId: z.string().min(1),
  method: z.enum([
    'emamectin-benzoate',
    'teflubenzuron',
    'azamethiphos',
    'hydrogen-peroxide',
    'deltamethrin',
    'thermal',
    'freshwater',
    'mechanical-brush',
    'cleaner-fish',
  ]),
  completedAt: instant,
  beforeCount: z.number().nonnegative().nullable(),
  afterCount: z.number().nonnegative().nullable(),
  note: z.string(),
});

export const mortalityRecordSchema = z.object({
  at: instant,
  count: z.number().int().nonnegative(),
  meanWeightG: z.number().positive(),
  cause: z.enum([
    'natural',
    'handling',
    'treatment',
    'disease',
    'winter-ulcer',
    'jellyfish',
    'algae',
    'predation',
    'escape-damage',
    'unknown',
  ]),
});

export const harvestSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  penId: z.string().min(1),
  plannedFor: instant,
  completedAt: nullableInstant,
  wellBoat: z.string(),
  plannedTonnes: z.number().nonnegative(),
  actualTonnes: z.number().nonnegative().nullable(),
  actualCount: z.number().int().nonnegative().nullable(),
  meanLiveWeightG: z.number().positive().nullable(),
  conditionFactor: z.number().positive().max(3).nullable(),
  note: z.string(),
});

export const oxygenReadingSchema = z.object({
  penId: z.string().min(1),
  at: instant,
  depthM: z.number().nonnegative(),
  temperatureC: z.number(),
  salinityPsu: z.number().nonnegative().nullable(),
  oxygenMgL: z.number().nonnegative(),
});

export type WireStockEvent = z.infer<typeof stockEventSchema>;
export type WireLiceCount = z.infer<typeof liceCountSchema>;
export type WireTreatment = z.infer<typeof treatmentSchema>;
export type WireHarvest = z.infer<typeof harvestSchema>;
export type WireOxygenReading = z.infer<typeof oxygenReadingSchema>;
