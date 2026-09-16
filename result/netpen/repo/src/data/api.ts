/**
 * The port the interface talks to.
 *
 * Every screen depends on this and nothing else. There are two
 * implementations: one over the in-process demonstration dataset and one over
 * HTTP. Keeping the seam here means the whole interface is testable without a
 * server, and the demonstration is not a separate code path that rots.
 *
 * Everything time dependent takes `now` explicitly. Nothing below this line
 * reads the clock, which is what makes a pinned screenshot and a pinned test
 * possible, and is enforced by the architecture test rather than by habit.
 */

import type { Alert } from '@/domain/alerts/types';
import type { MortalityCause } from '@/domain/health/mortality';
import type { TreatmentEvent, TreatmentMethod } from '@/domain/health/treatment';
import type { FishCount } from '@/domain/lice/counts';
import type { Pen, Site } from '@/domain/site/types';
import type { Generation, StockEvent, StockGroup } from '@/domain/stock/types';
import type { TemperatureSample } from '@/domain/time/degreeDays';
import type { Instant } from '@/domain/time/duration';

import type { LiceCount, OxygenReading, Person } from './fixtures';
import type { PenView } from './projections/pen';
import type { SiteView } from './projections/site';

export interface PenBoardRow {
  readonly view: PenView;
  /** Open alerts against this pen or the group in it, most urgent first. */
  readonly alerts: readonly Alert[];
}

export interface RecordCountRequest {
  readonly penId: string;
  readonly sample: readonly FishCount[];
  readonly countedBy: string;
  readonly seaTemperatureC: number | null;
  readonly note: string;
  readonly at: Instant;
}

export interface RecordTreatmentRequest {
  readonly penId: string;
  readonly method: TreatmentMethod;
  readonly beforeCount: number | null;
  readonly note: string;
  readonly at: Instant;
}

export interface RecordMortalityRequest {
  readonly groupId: string;
  readonly count: number;
  readonly meanWeightG: number;
  /**
   * Why they died. A stock event records a movement rather than a diagnosis,
   * so this does not become a field on the event; it is written into the note
   * in the wording the crew already use, which is what the mort book has said
   * for twenty years and what the vet reads it back out of.
   */
  readonly cause: MortalityCause;
  readonly note: string;
  readonly at: Instant;
}

export interface NetpenApi {
  getSite(): Promise<Site>;
  listPens(): Promise<readonly Pen[]>;
  listPeople(): Promise<readonly Person[]>;
  getGeneration(): Promise<Generation>;
  listGroups(): Promise<readonly StockGroup[]>;

  listPenBoard(now: Instant): Promise<readonly PenBoardRow[]>;
  getPen(penId: string, now: Instant): Promise<PenView>;
  getSiteView(now: Instant): Promise<SiteView>;

  listStockEvents(groupId: string): Promise<readonly StockEvent[]>;
  listLiceCounts(penId: string | null): Promise<readonly LiceCount[]>;
  listTreatments(penId: string | null): Promise<readonly TreatmentEvent[]>;
  listOxygen(penId: string, from: Instant, to: Instant): Promise<readonly OxygenReading[]>;
  listTemperatures(depthM: number): Promise<readonly TemperatureSample[]>;

  recordCount(request: RecordCountRequest): Promise<LiceCount>;
  recordTreatment(request: RecordTreatmentRequest): Promise<TreatmentEvent>;
  recordMortality(request: RecordMortalityRequest): Promise<StockEvent>;

  listAlerts(now: Instant): Promise<readonly Alert[]>;
  acknowledgeAlert(alertId: string, personId: string, at: Instant): Promise<Alert>;
}

/** Thrown when an id does not resolve. */
export class NotFoundError extends Error {
  readonly resource: string;
  readonly id: string;

  constructor(resource: string, id: string) {
    super(`No ${resource} with id ${id}`);
    this.name = 'NotFoundError';
    this.resource = resource;
    this.id = id;
  }
}

/** Thrown when a request is refused for a reason the crew can act on. */
export class RefusedError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = 'RefusedError';
    this.reason = reason;
  }
}

export const QUERY_KEYS = {
  site: ['site'] as const,
  pens: ['pens'] as const,
  people: ['people'] as const,
  generation: ['generation'] as const,
  groups: ['groups'] as const,
  penBoard: (bucket: number) => ['pen-board', bucket] as const,
  pen: (penId: string, bucket: number) => ['pen', penId, bucket] as const,
  siteView: (bucket: number) => ['site-view', bucket] as const,
  stockEvents: (groupId: string) => ['stock-events', groupId] as const,
  liceCounts: (penId: string | null) => ['lice-counts', penId ?? 'all'] as const,
  treatments: (penId: string | null) => ['treatments', penId ?? 'all'] as const,
  oxygen: (penId: string, from: number, to: number) => ['oxygen', penId, from, to] as const,
  temperatures: (depthM: number) => ['temperatures', depthM] as const,
  alerts: (bucket: number) => ['alerts', bucket] as const,
};
