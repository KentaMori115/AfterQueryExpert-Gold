/**
 * The in-process implementation of the API port.
 *
 * Holds a mutable copy of the demonstration dataset so a count entered or a
 * treatment recorded actually sticks for the length of a session. Reads go
 * through the same projections the HTTP implementation would return, so a
 * screen cannot tell the difference and neither can a test.
 *
 * Alerts are recomputed from live conditions on every read and reconciled
 * against what is already open, which is what a server side scheduler would
 * do. Doing it on read keeps the demonstration honest: the alert list is never
 * a hand written fixture, it is what the rules actually say about the data.
 *
 * Projections are cached per instant. Building a pen view folds a year of
 * stock events and integrates a temperature series, and the board asks for all
 * eight pens while the site view asks again and the alert pass asks a third
 * time, all within one tick and all with the same `now`.
 */

import { acknowledge, idFactory, reconcile } from '@/domain/alerts/reconcile';
import type { Alert } from '@/domain/alerts/types';
import { byUrgency } from '@/domain/alerts/types';
import { CAUSE_LABELS, type MortalityCause } from '@/domain/health/mortality';
import type { TreatmentEvent } from '@/domain/health/treatment';
import { countId, treatmentId } from '@/domain/ids';
import type { Pen } from '@/domain/site/types';
import type { StockEvent } from '@/domain/stock/types';
import type { Instant } from '@/domain/time/duration';

import {
  NotFoundError,
  RefusedError,
  type NetpenApi,
  type PenBoardRow,
  type RecordCountRequest,
  type RecordMortalityRequest,
  type RecordTreatmentRequest,
} from './api';
import type { Dataset, LiceCount } from './fixtures';
import { maySignOffCount } from './fixtures/site';
import { CAUSE_NOTES } from './fixtures/stock';
import { createContext, eventsFor, oxygenBetween, type DataContext } from './projections/context';
import { projectPen, type PenView } from './projections/pen';
import { projectSite, type SiteView } from './projections/site';

interface State {
  dataset: Dataset;
  context: DataContext;
  alerts: Alert[];
  penViews: Map<string, PenView>;
  siteView: SiteView | null;
  viewsAt: Instant | null;
}

/**
 * The cause, written into the note the way the mort book writes it. The
 * wording comes from the same table the generated record uses, so a manually
 * entered mortality and a generated one read identically.
 */
function noteFor(request: { cause: MortalityCause; note: string }): string {
  const wording = CAUSE_NOTES[request.cause] ?? CAUSE_LABELS[request.cause];
  return request.note === '' ? wording : `${wording}. ${request.note}`;
}

export function createLocalApi(dataset: Dataset): NetpenApi {
  const state: State = {
    dataset,
    context: createContext(dataset),
    alerts: [],
    penViews: new Map(),
    siteView: null,
    viewsAt: null,
  };

  const nextAlertId = idFactory();
  let sequence = 0;

  function replace(next: Dataset): void {
    state.dataset = next;
    state.context = createContext(next);
    // Anything cached was computed against the records that just changed.
    state.penViews.clear();
    state.siteView = null;
    state.viewsAt = null;
  }

  function generationFor(at: Instant): void {
    if (state.viewsAt !== at) {
      state.penViews.clear();
      state.siteView = null;
      state.viewsAt = at;
    }
  }

  function penView(penIdValue: string, at: Instant): PenView | null {
    generationFor(at);
    const cached = state.penViews.get(penIdValue);
    if (cached) return cached;

    const pen = state.context.penById.get(penIdValue);
    if (!pen) return null;

    const view = projectPen({ context: state.context, pen, now: at });
    state.penViews.set(penIdValue, view);
    return view;
  }

  function siteView(at: Instant): SiteView {
    generationFor(at);
    if (state.siteView === null) {
      state.siteView = projectSite({ context: state.context, now: at });
    }
    return state.siteView;
  }

  function refreshAlerts(at: Instant): Alert[] {
    const result = reconcile(state.alerts, siteView(at).alerts, { now: at, nextId: nextAlertId });
    state.alerts = [...result.next];
    return state.alerts;
  }

  return {
    getSite: () => Promise.resolve(state.dataset.site),
    listPens: () => Promise.resolve(state.dataset.pens),
    listPeople: () => Promise.resolve(state.dataset.people),
    getGeneration: () => Promise.resolve(state.dataset.generation),
    listGroups: () => Promise.resolve(state.dataset.groups),

    listPenBoard(now) {
      const open = refreshAlerts(now).filter((alert) => alert.clearedAt === null);

      const rows: PenBoardRow[] = state.dataset.pens.map((pen) => {
        const view = penView(String(pen.id), now)!;
        const groupIdValue = view.group === null ? null : String(view.group.id);

        return {
          view,
          alerts: open
            .filter((alert) => {
              if (alert.subject.type === 'pen') {
                return String(alert.subject.penId) === String(pen.id);
              }
              if (alert.subject.type === 'group') {
                return groupIdValue !== null && String(alert.subject.groupId) === groupIdValue;
              }
              return false;
            })
            .sort(byUrgency),
        };
      });

      return Promise.resolve(rows);
    },

    getPen(penIdValue, now) {
      const view = penView(penIdValue, now);
      if (!view) return Promise.reject(new NotFoundError('pen', penIdValue));
      return Promise.resolve(view);
    },

    getSiteView(now) {
      return Promise.resolve(siteView(now));
    },

    listStockEvents(groupIdValue) {
      return Promise.resolve(eventsFor(state.context, groupIdValue));
    },

    listLiceCounts(penIdValue) {
      if (penIdValue === null) return Promise.resolve(state.dataset.liceCounts);
      return Promise.resolve(state.context.liceByPen.get(penIdValue) ?? []);
    },

    listTreatments(penIdValue) {
      if (penIdValue === null) return Promise.resolve(state.dataset.treatments);
      return Promise.resolve(state.context.treatmentsByPen.get(penIdValue) ?? []);
    },

    listOxygen(penIdValue, from, to) {
      return Promise.resolve(oxygenBetween(state.context, penIdValue, from, to));
    },

    listTemperatures(depthM) {
      return Promise.resolve(state.context.temperaturesAt(depthM));
    },

    recordCount(request: RecordCountRequest) {
      const pen = state.context.penById.get(request.penId);
      if (!pen) return Promise.reject(new NotFoundError('pen', request.penId));

      const group = state.context.groupByPen.get(request.penId);
      if (!group || (group.closedAt !== null && group.closedAt <= request.at)) {
        return Promise.reject(new RefusedError('That pen is not holding fish', 'pen-not-stocked'));
      }

      const person = state.context.personById.get(request.countedBy);
      if (!person) return Promise.reject(new NotFoundError('person', request.countedBy));
      if (!maySignOffCount(person)) {
        return Promise.reject(
          new RefusedError(
            `${person.name} may record a count but not sign it to the register`,
            'role-not-permitted',
          ),
        );
      }
      if (request.sample.length < 10) {
        return Promise.reject(
          new RefusedError('A count needs at least ten fish', 'sample-too-small'),
        );
      }

      sequence += 1;
      const count: LiceCount = {
        id: countId(`cnt-manual-${sequence}`),
        groupId: group.id,
        penId: pen.id,
        countedAt: request.at,
        countedBy: request.countedBy,
        sample: request.sample,
        seaTemperatureC: request.seaTemperatureC,
        note: request.note,
      };

      replace({ ...state.dataset, liceCounts: [...state.dataset.liceCounts, count] });
      return Promise.resolve(count);
    },

    recordTreatment(request: RecordTreatmentRequest) {
      const pen = state.context.penById.get(request.penId);
      if (!pen) return Promise.reject(new NotFoundError('pen', request.penId));

      sequence += 1;
      const treatment: TreatmentEvent = {
        id: treatmentId(`trt-manual-${sequence}`),
        method: request.method,
        completedAt: request.at,
        penId: request.penId,
        beforeCount: request.beforeCount,
        afterCount: null,
        note: request.note,
      };

      replace({ ...state.dataset, treatments: [...state.dataset.treatments, treatment] });
      return Promise.resolve(treatment);
    },

    recordMortality(request: RecordMortalityRequest) {
      const group = state.context.groupById.get(request.groupId);
      if (!group) return Promise.reject(new NotFoundError('group', request.groupId));
      if (request.count <= 0) {
        return Promise.reject(
          new RefusedError('A mortality record needs a positive count', 'count-not-positive'),
        );
      }

      sequence += 1;
      const event: StockEvent = {
        id: `evt-manual-${sequence}`,
        groupId: group.id,
        at: request.at,
        kind: 'mortality',
        countDelta: -request.count,
        meanWeightG: request.meanWeightG,
        note: noteFor(request),
      };

      replace({ ...state.dataset, events: [...state.dataset.events, event] });
      return Promise.resolve(event);
    },

    listAlerts(now) {
      return Promise.resolve([...refreshAlerts(now)].sort(byUrgency));
    },

    acknowledgeAlert(alertIdValue, personIdValue, at) {
      const alert = state.alerts.find((candidate) => String(candidate.id) === alertIdValue);
      if (!alert) return Promise.reject(new NotFoundError('alert', alertIdValue));

      const acknowledged = acknowledge(alert, personIdValue, at);
      state.alerts = state.alerts.map((candidate) =>
        candidate === alert ? acknowledged : candidate,
      );
      return Promise.resolve(acknowledged);
    },
  };
}

/** Pens in grid order, which is how every screen lists them. */
export function sortPens(pens: readonly Pen[]): Pen[] {
  return [...pens].sort((a, b) => a.number - b.number);
}
