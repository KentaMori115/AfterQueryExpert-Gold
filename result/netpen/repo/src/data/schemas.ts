/**
 * Wire schemas for the site and its pens.
 *
 * Everything crossing the boundary is parsed rather than cast. The feed barge
 * and the counting app both post into the same service, they are on different
 * release cycles, and a field that quietly changes type is a thing that
 * happens. Parsing means it shows up here, naming the field, instead of as a
 * NaN inside a biomass total four screens later.
 *
 * Timestamps arrive as ISO 8601 strings and become epoch milliseconds at this
 * boundary. Nothing above this layer knows the wire format.
 */

import { z } from 'zod';

export const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => Date.parse(value));

export const nullableInstant = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .transform((value) => (value === null ? null : Date.parse(value)));

const finite = z.number().finite();

export const positionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const penGeometrySchema = z.object({
  circumferenceM: z.number().positive().max(500),
  depthM: z.number().positive().max(80),
});

export const siteSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  operator: z.string(),
  regime: z.enum(['norway', 'scotland']),
  position: positionSchema,
  maxBiomassT: z.number().positive(),
  fallowWeeks: z.number().int().nonnegative(),
  status: z.enum(['stocked', 'harvesting', 'fallow', 'mothballed']),
  manager: z.string().nullable(),
  depthM: z.number().positive(),
  notes: z.string(),
});

export const penSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  number: z.number().int().positive(),
  geometry: penGeometrySchema,
  status: z.enum(['stocked', 'empty', 'maintenance', 'withdrawn']),
  netInstalledAt: nullableInstant,
  notes: z.string(),
});

export const generationSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  code: z.string().min(1),
  input: z.enum(['spring', 'autumn']),
  status: z.enum(['planned', 'stocking', 'growing', 'harvesting', 'closed']),
  hatchery: z.string(),
  strain: z.string(),
  firstStockedAt: nullableInstant,
  lastHarvestedAt: nullableInstant,
  budgetTgc: z.number().positive().max(6),
  budgetFcr: z.number().positive().max(3),
  notes: z.string(),
});

export const groupSchema = z.object({
  id: z.string().min(1),
  generationId: z.string().min(1),
  penId: z.string().min(1),
  reference: z.string().min(1),
  stockedAt: instant,
  closedAt: nullableInstant,
  notes: z.string(),
});

export const personSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['site-manager', 'husbandry', 'veterinary', 'planner', 'regulator']),
  organisation: z.string(),
  initials: z.string().min(1).max(3),
});

/**
 * Temperature is carried as flat pairs rather than objects. A site holds a
 * daily mean at five depths for eighteen months, and the object form is very
 * nearly double the bytes for no benefit at all over a marine link.
 */
export const temperatureSeriesSchema = z.object({
  siteId: z.string().min(1),
  depthM: finite,
  samples: z.array(z.tuple([instant, finite])),
});

export type WireSite = z.infer<typeof siteSchema>;
export type WirePen = z.infer<typeof penSchema>;
export type WireGeneration = z.infer<typeof generationSchema>;
export type WireGroup = z.infer<typeof groupSchema>;
export type WirePerson = z.infer<typeof personSchema>;
export type WireTemperatureSeries = z.infer<typeof temperatureSeriesSchema>;
