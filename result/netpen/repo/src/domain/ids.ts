/**
 * Branded identifiers.
 *
 * Half the identifiers on a site look alike: a pen is "3", a generation is
 * "S24", a group is "S24-P3". They get passed to functions that take a string
 * and the compiler has nothing to say about it. Branding them means a pen id
 * cannot be handed to something expecting a group id, which is a mistake that
 * has been made, produces a plausible-looking empty result, and is invisible
 * in a plain string signature.
 */

declare const brand: unique symbol;

type Branded<T, B extends string> = T & { readonly [brand]: B };

export type SiteId = Branded<string, 'SiteId'>;
export type PenId = Branded<string, 'PenId'>;
export type GenerationId = Branded<string, 'GenerationId'>;
export type GroupId = Branded<string, 'GroupId'>;
export type CountId = Branded<string, 'CountId'>;
export type TreatmentId = Branded<string, 'TreatmentId'>;
export type HarvestId = Branded<string, 'HarvestId'>;
export type PersonId = Branded<string, 'PersonId'>;
export type AlertId = Branded<string, 'AlertId'>;
export type EventId = Branded<string, 'EventId'>;

const cast = <B extends string>(value: string): Branded<string, B> => value as Branded<string, B>;

export const siteId = (value: string): SiteId => cast<'SiteId'>(value);
export const penId = (value: string): PenId => cast<'PenId'>(value);
export const generationId = (value: string): GenerationId => cast<'GenerationId'>(value);
export const groupId = (value: string): GroupId => cast<'GroupId'>(value);
export const countId = (value: string): CountId => cast<'CountId'>(value);
export const treatmentId = (value: string): TreatmentId => cast<'TreatmentId'>(value);
export const harvestId = (value: string): HarvestId => cast<'HarvestId'>(value);
export const personId = (value: string): PersonId => cast<'PersonId'>(value);
export const alertId = (value: string): AlertId => cast<'AlertId'>(value);
export const eventId = (value: string): EventId => cast<'EventId'>(value);
