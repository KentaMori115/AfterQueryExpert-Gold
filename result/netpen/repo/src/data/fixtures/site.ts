/**
 * The demonstration site: Eilean Dubh, on the Scottish west coast.
 *
 * Eight pens on a two by four grid in about forty metres of water, licensed
 * for two and a half thousand tonnes, running under the Scottish lice regime.
 * The shape is deliberately ordinary: this is what most sites look like, and a
 * demonstration built on an unusual one teaches the wrong lessons.
 *
 * Two pens are not carrying fish. Pen 7 is empty after a consolidation and pen
 * 8 has its net off for repair, which is the normal state of affairs and means
 * the interface has to show both without treating either as an error.
 */

import { penId, personId, siteId } from '@/domain/ids';
import type { Pen, Site } from '@/domain/site/types';
import { parseInstant } from '@/domain/time/duration';

export const EILEAN_DUBH: Site = {
  id: siteId('site-eilean-dubh'),
  code: 'FS-0412',
  name: 'Eilean Dubh',
  operator: 'Caledonian Marine Farms',
  regime: 'scotland',
  position: { latitude: 57.4218, longitude: -5.9104 },
  maxBiomassT: 2_500,
  fallowWeeks: 6,
  status: 'stocked',
  manager: personId('per-tait'),
  depthM: 41,
  notes: 'Exposed to the south west. Wave gauge on the feed barge since 2023.',
};

interface PenSeed {
  readonly number: number;
  readonly circumferenceM: number;
  readonly depthM: number;
  readonly status: Pen['status'];
  readonly netAgeWeeks: number | null;
  readonly notes: string;
}

const PEN_SEEDS: readonly PenSeed[] = [
  { number: 1, circumferenceM: 157, depthM: 22, status: 'stocked', netAgeWeeks: 46, notes: '' },
  { number: 2, circumferenceM: 157, depthM: 22, status: 'stocked', netAgeWeeks: 46, notes: '' },
  { number: 3, circumferenceM: 157, depthM: 22, status: 'stocked', netAgeWeeks: 44, notes: '' },
  { number: 4, circumferenceM: 157, depthM: 22, status: 'stocked', netAgeWeeks: 44, notes: '' },
  {
    number: 5,
    circumferenceM: 120,
    depthM: 20,
    status: 'stocked',
    netAgeWeeks: 101,
    notes: 'Net coming up on its service life, change booked for the autumn.',
  },
  { number: 6, circumferenceM: 157, depthM: 22, status: 'stocked', netAgeWeeks: 44, notes: '' },
  {
    number: 7,
    circumferenceM: 120,
    depthM: 20,
    status: 'empty',
    netAgeWeeks: 44,
    notes: 'Emptied into pens 3 and 4 after the February mortality.',
  },
  {
    number: 8,
    circumferenceM: 120,
    depthM: 20,
    status: 'maintenance',
    netAgeWeeks: null,
    notes: 'Net ashore for repair after storm damage to the bottom ring.',
  },
];

/** Pens are built against an instant so the net ages stay put relative to it. */
export function buildPens(now: number): Pen[] {
  return PEN_SEEDS.map((seed) => ({
    id: penId(`pen-${seed.number}`),
    siteId: EILEAN_DUBH.id,
    number: seed.number,
    geometry: { circumferenceM: seed.circumferenceM, depthM: seed.depthM },
    status: seed.status,
    netInstalledAt: seed.netAgeWeeks === null ? null : now - seed.netAgeWeeks * 604_800_000,
    notes: seed.notes,
  }));
}

export type Role = 'site-manager' | 'husbandry' | 'veterinary' | 'planner' | 'regulator';

export interface Person {
  readonly id: ReturnType<typeof personId>;
  readonly name: string;
  readonly role: Role;
  readonly organisation: string;
  readonly initials: string;
}

export const PEOPLE: readonly Person[] = [
  {
    id: personId('per-tait'),
    name: 'Morven Tait',
    role: 'site-manager',
    organisation: 'Caledonian Marine Farms',
    initials: 'MT',
  },
  {
    id: personId('per-oduya'),
    name: 'Samuel Oduya',
    role: 'husbandry',
    organisation: 'Caledonian Marine Farms',
    initials: 'SO',
  },
  {
    id: personId('per-lindqvist'),
    name: 'Ingrid Lindqvist',
    role: 'veterinary',
    organisation: 'Aquavet Highland',
    initials: 'IL',
  },
  {
    id: personId('per-abbas'),
    name: 'Yusuf Abbas',
    role: 'planner',
    organisation: 'Caledonian Marine Farms',
    initials: 'YA',
  },
  {
    id: personId('per-crawford'),
    name: 'Elaine Crawford',
    role: 'regulator',
    organisation: 'Fish Health Inspectorate',
    initials: 'EC',
  },
];

const BY_ID = new Map(PEOPLE.map((person) => [String(person.id), person]));

export function personById(id: string | null): Person | null {
  return id === null ? null : (BY_ID.get(id) ?? null);
}

export function displayName(id: string | null): string {
  return personById(id)?.name ?? 'Unassigned';
}

/** Roles allowed to sign a lice count off to the register. */
export const COUNT_SIGNOFF_ROLES: readonly Role[] = ['site-manager', 'veterinary'];

export function maySignOffCount(person: Person): boolean {
  return COUNT_SIGNOFF_ROLES.includes(person.role);
}

export const ROLE_LABELS: Record<Role, string> = {
  'site-manager': 'Site manager',
  husbandry: 'Husbandry',
  veterinary: 'Veterinary',
  planner: 'Production planner',
  regulator: 'Inspector',
};

/** The reference stocking date the whole demonstration cycle hangs off. */
export const STOCKED_AT = parseInstant('2024-04-22T00:00:00Z');
