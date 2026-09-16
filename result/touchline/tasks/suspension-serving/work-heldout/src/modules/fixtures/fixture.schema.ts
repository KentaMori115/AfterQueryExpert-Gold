/** What a caller may send to the fixture routes. */
import { z } from 'zod';
import { AWARD_REASONS, FIXTURE_STATUSES } from './fixture.types';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');
export const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must read HH:MM on a 24 hour clock');

export const scheduleFixtureBody = z
  .object({
    homeTeamId: z.number().int().positive(),
    awayTeamId: z.number().int().positive(),
    venueId: z.number().int().positive(),
    playedOn: dayField,
    kickOff: timeField,
  })
  .strict();

export const rescheduleFixtureBody = z
  .object({
    playedOn: dayField,
    kickOff: timeField,
    venueId: z.number().int().positive().optional(),
  })
  .strict();

export const postponeFixtureBody = z.object({ postponedOn: dayField }).strict();
export const abandonFixtureBody = z.object({ abandonedOn: dayField }).strict();

export const awardFixtureBody = z
  .object({
    awardedOn: dayField,
    awardedToTeamId: z.number().int().positive(),
    reason: z.enum(AWARD_REASONS),
  })
  .strict();

export const divisionIdParams = z
  .object({ divisionId: z.coerce.number().int().positive() })
  .strict();

export const fixtureIdParams = z.object({ fixtureId: z.coerce.number().int().positive() }).strict();

export const listFixturesQuery = z
  .object({
    divisionId: z.coerce.number().int().positive().optional(),
    teamId: z.coerce.number().int().positive().optional(),
    venueId: z.coerce.number().int().positive().optional(),
    status: z.enum(FIXTURE_STATUSES).optional(),
    playedOn: dayField.optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type ScheduleFixtureBody = z.infer<typeof scheduleFixtureBody>;
export type RescheduleFixtureBody = z.infer<typeof rescheduleFixtureBody>;
export type PostponeFixtureBody = z.infer<typeof postponeFixtureBody>;
export type AbandonFixtureBody = z.infer<typeof abandonFixtureBody>;
export type AwardFixtureBody = z.infer<typeof awardFixtureBody>;
export type ListFixturesQuery = z.infer<typeof listFixturesQuery>;
