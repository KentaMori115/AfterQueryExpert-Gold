/**
 * Every rule about a season that could be argued about.
 *
 * The two that matter downstream: a season only runs between the day it opens
 * and the day it closes, and registrations shut before the season ends, so a
 * club cannot sign a ringer in the last week.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import { SeasonRepository } from './season.repository';
import {
  DEFAULT_POINTS_DRAW,
  DEFAULT_POINTS_LOSS,
  DEFAULT_POINTS_WIN,
  SEASON_TRANSITIONS,
  type Season,
  type SeasonStatus,
} from './season.types';

export interface CreateSeason {
  name: string;
  startsOn: string;
  endsOn: string;
  registrationClosesOn: string;
  pointsWin?: number;
  pointsDraw?: number;
  pointsLoss?: number;
}

export class SeasonService {
  constructor(private readonly repo: SeasonRepository) {}

  create(input: CreateSeason): Season {
    const startsOn = requireRealDay(input.startsOn, 'startsOn');
    const endsOn = requireRealDay(input.endsOn, 'endsOn');
    const registrationClosesOn = requireRealDay(input.registrationClosesOn, 'registrationClosesOn');

    if (!isAfter(endsOn, startsOn)) {
      throw new ConflictError('A season has to end after it starts', { startsOn, endsOn });
    }
    if (isAfter(registrationClosesOn, endsOn) || isAfter(startsOn, registrationClosesOn)) {
      throw new ConflictError('Registration closes between the first and last day of the season', {
        startsOn,
        endsOn,
        registrationClosesOn,
      });
    }
    if (this.repo.byName(input.name) !== undefined) {
      throw new ConflictError('There is already a season by that name', { name: input.name });
    }
    const clash = this.repo.overlapping(startsOn, endsOn);
    if (clash.length > 0) {
      throw new ConflictError('That window overlaps a season the league already has', {
        startsOn,
        endsOn,
        clashesWith: clash.map((season) => season.id),
      });
    }

    return this.repo.insert({
      name: input.name,
      startsOn,
      endsOn,
      registrationClosesOn,
      pointsWin: input.pointsWin ?? DEFAULT_POINTS_WIN,
      pointsDraw: input.pointsDraw ?? DEFAULT_POINTS_DRAW,
      pointsLoss: input.pointsLoss ?? DEFAULT_POINTS_LOSS,
    });
  }

  get(seasonId: number): Season {
    const season = this.repo.byId(seasonId);
    if (season === undefined) throw new NotFoundError(`There is no season ${seasonId}`);
    return season;
  }

  list(filter: { status?: SeasonStatus }): Season[] {
    return this.repo.list(filter);
  }

  update(
    seasonId: number,
    changes: { name?: string; endsOn?: string; registrationClosesOn?: string },
  ): Season {
    const season = this.get(seasonId);
    if (season.status === 'closed') {
      throw new ConflictError('A closed season cannot be changed', { seasonId });
    }
    const endsOn =
      changes.endsOn !== undefined ? requireRealDay(changes.endsOn, 'endsOn') : season.endsOn;
    const registrationClosesOn =
      changes.registrationClosesOn !== undefined
        ? requireRealDay(changes.registrationClosesOn, 'registrationClosesOn')
        : season.registrationClosesOn;

    if (!isAfter(endsOn, season.startsOn)) {
      throw new ConflictError('A season has to end after it starts', {
        startsOn: season.startsOn,
        endsOn,
      });
    }
    if (isAfter(registrationClosesOn, endsOn) || isAfter(season.startsOn, registrationClosesOn)) {
      throw new ConflictError('Registration closes between the first and last day of the season', {
        startsOn: season.startsOn,
        endsOn,
        registrationClosesOn,
      });
    }
    if (changes.name !== undefined) {
      const other = this.repo.byName(changes.name);
      if (other !== undefined && other.id !== seasonId) {
        throw new ConflictError('There is already a season by that name', { name: changes.name });
      }
    }
    const clash = this.repo.overlapping(season.startsOn, endsOn, seasonId);
    if (clash.length > 0) {
      throw new ConflictError('That window overlaps a season the league already has', {
        clashesWith: clash.map((other) => other.id),
      });
    }

    return this.repo.update(seasonId, {
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.endsOn !== undefined ? { endsOn } : {}),
      ...(changes.registrationClosesOn !== undefined ? { registrationClosesOn } : {}),
    });
  }

  private moveTo(season: Season, next: SeasonStatus): void {
    if (!SEASON_TRANSITIONS[season.status].includes(next)) {
      throw new ConflictError(`A ${season.status} season cannot become ${next}`, {
        seasonId: season.id,
        status: season.status,
      });
    }
  }

  open(seasonId: number, openedOn: string): Season {
    const season = this.get(seasonId);
    this.moveTo(season, 'running');
    const day = requireRealDay(openedOn, 'openedOn');
    if (isAfter(season.startsOn, day)) {
      throw new ConflictError('A season cannot open before its first day', {
        startsOn: season.startsOn,
        openedOn: day,
      });
    }
    if (isAfter(day, season.endsOn)) {
      throw new ConflictError('A season cannot open after its last day', {
        endsOn: season.endsOn,
        openedOn: day,
      });
    }
    return this.repo.update(seasonId, { status: 'running', openedOn: day });
  }

  close(seasonId: number, closedOn: string): Season {
    const season = this.get(seasonId);
    this.moveTo(season, 'closed');
    const day = requireRealDay(closedOn, 'closedOn');
    if (season.openedOn !== null && isAfter(season.openedOn, day)) {
      throw new ConflictError('A season cannot close before it opened', {
        openedOn: season.openedOn,
        closedOn: day,
      });
    }
    return this.repo.update(seasonId, { status: 'closed', closedOn: day });
  }

  /** Downstream modules ask this before letting anything be recorded against a season. */
  requireUnderway(seasonId: number): Season {
    const season = this.get(seasonId);
    if (season.status !== 'running') {
      throw new ConflictError(`Season ${seasonId} is ${season.status}, not running`, {
        seasonId,
        status: season.status,
      });
    }
    return season;
  }
}
