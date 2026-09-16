import { beforeEach, describe, expect, it } from 'vitest';

import { NotFoundError, RefusedError, type NetpenApi } from '@/data/api';
import { buildDataset } from '@/data/fixtures';
import { createLocalApi } from '@/data/localApi';
import { EMPTY_FISH, type FishCount } from '@/domain/lice/counts';
import { addDays, parseInstant } from '@/domain/time/duration';

const NOW = parseInstant('2025-05-12T09:00:00Z');

let api: NetpenApi;

beforeEach(() => {
  api = createLocalApi(buildDataset(NOW));
});

function sample(adultFemale: number, size = 20): FishCount[] {
  return Array.from({ length: size }, (_unused, index) => ({
    ...EMPTY_FISH,
    adultFemale: index < adultFemale * size ? 1 : 0,
  }));
}

describe('reads', () => {
  it('returns the site and its pens', async () => {
    expect((await api.getSite()).code).toBe('FS-0412');
    expect(await api.listPens()).toHaveLength(8);
  });

  it('builds a board row per pen with its alerts attached', async () => {
    const rows = await api.listPenBoard(NOW);
    expect(rows).toHaveLength(8);
    expect(rows.some((row) => row.alerts.length > 0)).toBe(true);
  });

  it('sorts a row’s alerts most urgent first', async () => {
    for (const row of await api.listPenBoard(NOW)) {
      const ranks = row.alerts.map((alert) =>
        alert.severity === 'urgent' ? 0 : alert.severity === 'warning' ? 1 : 2,
      );
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
  });

  it('resolves a single pen and rejects one that is not there', async () => {
    expect((await api.getPen('pen-2', NOW)).pen.number).toBe(2);
    await expect(api.getPen('pen-99', NOW)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the site view with its licence position', async () => {
    const site = await api.getSiteView(NOW);
    expect(site.licence.limitT).toBe(2_500);
    expect(site.projection.length).toBeGreaterThan(20);
  });

  it('filters lice counts and treatments by pen', async () => {
    const all = await api.listLiceCounts(null);
    const one = await api.listLiceCounts('pen-2');
    expect(one.length).toBeGreaterThan(0);
    expect(one.length).toBeLessThan(all.length);
    expect(one.every((count) => String(count.penId) === 'pen-2')).toBe(true);
  });

  it('windows the oxygen record', async () => {
    const readings = await api.listOxygen('pen-2', addDays(NOW, -2), NOW);
    expect(readings.length).toBeGreaterThan(0);
    expect(readings.every((reading) => reading.at >= addDays(NOW, -2))).toBe(true);
  });
});

describe('caching within a tick', () => {
  it('hands back the same projection rather than rebuilding it', async () => {
    expect(await api.getPen('pen-2', NOW)).toBe(await api.getPen('pen-2', NOW));
  });

  it('shares the projection between the board and a single read', async () => {
    const board = await api.listPenBoard(NOW);
    const row = board.find((entry) => entry.view.pen.number === 2);
    expect(await api.getPen('pen-2', NOW)).toBe(row?.view);
  });

  it('rebuilds on a new instant', async () => {
    const first = await api.getPen('pen-2', NOW);
    expect(await api.getPen('pen-2', addDays(NOW, 1))).not.toBe(first);
  });
});

describe('alerts', () => {
  it('keeps the same alert identity across repeated reads', async () => {
    const first = await api.listAlerts(NOW);
    const second = await api.listAlerts(NOW);
    expect(second.map((alert) => alert.id)).toEqual(first.map((alert) => alert.id));
  });

  it('acknowledges one and keeps it acknowledged', async () => {
    const [alert] = await api.listAlerts(NOW);
    const acknowledged = await api.acknowledgeAlert(String(alert!.id), 'per-tait', NOW);
    expect(acknowledged.acknowledgedBy).toBe('per-tait');

    const again = await api.listAlerts(NOW);
    expect(again.find((candidate) => candidate.id === alert!.id)?.acknowledgedAt).not.toBeNull();
  });

  it('rejects acknowledging something that is not there', async () => {
    await expect(api.acknowledgeAlert('alr-nope', 'per-tait', NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('recording a lice count', () => {
  const base = {
    penId: 'pen-2',
    sample: sample(0.2),
    countedBy: 'per-tait',
    seaTemperatureC: 11.4,
    note: '',
    at: NOW,
  };

  it('files it against the group in that pen', async () => {
    const count = await api.recordCount(base);
    expect(String(count.groupId)).toBe('grp-s24-p2');
    expect((await api.listLiceCounts('pen-2')).some((entry) => entry.id === count.id)).toBe(true);
  });

  it('shows up in the pen projection straight away', async () => {
    const before = await api.getPen('pen-2', NOW);
    await api.recordCount({ ...base, sample: sample(0.9) });
    const after = await api.getPen('pen-2', NOW);
    expect(after).not.toBe(before);
    expect(after.lice.averages!.adultFemale).toBeGreaterThan(0.5);
  });

  it('refuses a pen that is not holding fish', async () => {
    await expect(api.recordCount({ ...base, penId: 'pen-7' })).rejects.toMatchObject({
      reason: 'pen-not-stocked',
    });
  });

  it('refuses a sample too small to mean anything', async () => {
    await expect(api.recordCount({ ...base, sample: sample(0.2, 6) })).rejects.toMatchObject({
      reason: 'sample-too-small',
    });
  });

  it('refuses somebody without the role to sign it', async () => {
    await expect(api.recordCount({ ...base, countedBy: 'per-abbas' })).rejects.toMatchObject({
      reason: 'role-not-permitted',
    });
  });

  it('accepts the vet as well as the site manager', async () => {
    await expect(api.recordCount({ ...base, countedBy: 'per-lindqvist' })).resolves.toBeTruthy();
  });
});

describe('recording a treatment', () => {
  it('files it against the pen and starts the withdrawal clock', async () => {
    const treatment = await api.recordTreatment({
      penId: 'pen-3',
      method: 'emamectin-benzoate',
      beforeCount: 0.8,
      note: 'In feed, seven days',
      at: NOW,
    });

    expect(treatment.penId).toBe('pen-3');
    const view = await api.getPen('pen-3', NOW);
    expect(view.withdrawal?.required).toBe(175);
    expect(view.withdrawal?.cleared).toBe(false);
    expect(view.blocking?.id).toBe(treatment.id);
  });

  it('leaves a mechanical treatment blocking nothing', async () => {
    await api.recordTreatment({
      penId: 'pen-3',
      method: 'thermal',
      beforeCount: 0.8,
      note: '',
      at: NOW,
    });
    expect((await api.getPen('pen-3', NOW)).blocking).toBeNull();
  });

  it('rejects a pen that is not there', async () => {
    await expect(
      api.recordTreatment({
        penId: 'pen-99',
        method: 'thermal',
        beforeCount: null,
        note: '',
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('recording a mortality', () => {
  it('takes the fish off the standing count', async () => {
    const before = await api.getPen('pen-2', NOW);
    await api.recordMortality({
      groupId: 'grp-s24-p2',
      count: 400,
      meanWeightG: 4_200,
      cause: 'natural',
      note: 'Mort lift',
      at: NOW,
    });
    const after = await api.getPen('pen-2', NOW);
    expect(after.position!.count).toBe(before.position!.count - 400);
  });

  it('refuses a record that moves no fish', async () => {
    await expect(
      api.recordMortality({
        groupId: 'grp-s24-p2',
        count: 0,
        meanWeightG: 4_200,
        cause: 'natural',
        note: '',
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(RefusedError);
  });

  it('writes the cause into the note the way the mort book does', async () => {
    const event = await api.recordMortality({
      groupId: 'grp-s24-p2',
      count: 40,
      meanWeightG: 4_200,
      cause: 'winter-ulcer',
      note: 'Two cages checked',
      at: NOW,
    });
    expect(event.note).toBe('Winter ulcer outbreak. Two cages checked');
  });

  it('writes the cause alone where there is nothing to add to it', async () => {
    const event = await api.recordMortality({
      groupId: 'grp-s24-p2',
      count: 40,
      meanWeightG: 4_200,
      cause: 'predation',
      note: '',
      at: NOW,
    });
    expect(event.note).toBe('Predation');
  });

  it('rejects a group that is not there', async () => {
    await expect(
      api.recordMortality({
        groupId: 'grp-nope',
        count: 5,
        meanWeightG: 4_200,
        cause: 'natural',
        note: '',
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
