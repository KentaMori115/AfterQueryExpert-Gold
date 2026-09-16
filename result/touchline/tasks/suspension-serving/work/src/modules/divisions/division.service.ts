/**
 * Every rule about a division that could be argued about.
 *
 * Two matter downstream. A tier is held by one division per season, so
 * promotion always has somewhere unambiguous to send a team. And the places
 * going up plus the places going down cannot swallow the whole division, or a
 * season would end with nobody left where they started.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import type { SeasonService } from '../seasons/season.service';
import { DivisionRepository, type DivisionFilter } from './division.repository';
import { DIVISION_TRANSITIONS, type Division, type DivisionStatus } from './division.types';

export interface CreateDivision {
  name: string;
  tier: number;
  teamCapacity: number;
  promotionPlaces: number;
  relegationPlaces: number;
}

export class DivisionService {
  constructor(
    private readonly repo: DivisionRepository,
    private readonly seasons: SeasonService,
  ) {}

  private checkPlaces(capacity: number, promotion: number, relegation: number): void {
    if (promotion + relegation >= capacity) {
      throw new ConflictError(
        'The places going up and down would leave nobody where they started',
        { teamCapacity: capacity, promotionPlaces: promotion, relegationPlaces: relegation },
      );
    }
  }

  create(seasonId: number, input: CreateDivision): Division {
    const season = this.seasons.get(seasonId);
    if (season.status === 'closed') {
      throw new ConflictError('A closed season takes no new divisions', { seasonId });
    }
    if (this.repo.byNameInSeason(seasonId, input.name) !== undefined) {
      throw new ConflictError('That season already has a division by that name', {
        seasonId,
        name: input.name,
      });
    }
    if (this.repo.byTierInSeason(seasonId, input.tier) !== undefined) {
      throw new ConflictError('That season already has a division at that tier', {
        seasonId,
        tier: input.tier,
      });
    }
    this.checkPlaces(input.teamCapacity, input.promotionPlaces, input.relegationPlaces);
    return this.repo.insert({ seasonId, ...input });
  }

  get(divisionId: number): Division {
    const division = this.repo.byId(divisionId);
    if (division === undefined) throw new NotFoundError(`There is no division ${divisionId}`);
    return division;
  }

  list(filter: DivisionFilter): Division[] {
    if (filter.seasonId !== undefined) this.seasons.get(filter.seasonId);
    return this.repo.list(filter);
  }

  update(
    divisionId: number,
    changes: {
      name?: string;
      teamCapacity?: number;
      promotionPlaces?: number;
      relegationPlaces?: number;
    },
  ): Division {
    const division = this.get(divisionId);
    if (division.status !== 'forming') {
      throw new ConflictError('A division stops changing once its entries are fixed', {
        divisionId,
        status: division.status,
      });
    }
    if (changes.name !== undefined) {
      const other = this.repo.byNameInSeason(division.seasonId, changes.name);
      if (other !== undefined && other.id !== divisionId) {
        throw new ConflictError('That season already has a division by that name', {
          name: changes.name,
        });
      }
    }
    this.checkPlaces(
      changes.teamCapacity ?? division.teamCapacity,
      changes.promotionPlaces ?? division.promotionPlaces,
      changes.relegationPlaces ?? division.relegationPlaces,
    );
    return this.repo.update(divisionId, changes);
  }

  private moveTo(division: Division, next: DivisionStatus): void {
    if (!DIVISION_TRANSITIONS[division.status].includes(next)) {
      throw new ConflictError(`A ${division.status} division cannot become ${next}`, {
        divisionId: division.id,
        status: division.status,
      });
    }
  }

  fix(divisionId: number, fixedOn: string): Division {
    const division = this.get(divisionId);
    this.moveTo(division, 'fixed');
    const day = requireRealDay(fixedOn, 'fixedOn');
    const season = this.seasons.get(division.seasonId);
    if (isAfter(season.startsOn, day)) {
      throw new ConflictError('Entries cannot be fixed before the season starts', {
        startsOn: season.startsOn,
        fixedOn: day,
      });
    }
    return this.repo.update(divisionId, { status: 'fixed', fixedOn: day });
  }

  complete(divisionId: number, completedOn: string): Division {
    const division = this.get(divisionId);
    this.moveTo(division, 'completed');
    const day = requireRealDay(completedOn, 'completedOn');
    if (division.fixedOn !== null && isAfter(division.fixedOn, day)) {
      throw new ConflictError('A division cannot finish before its entries were fixed', {
        fixedOn: division.fixedOn,
        completedOn: day,
      });
    }
    return this.repo.update(divisionId, { status: 'completed', completedOn: day });
  }

  /** Teams ask this before entering; entries shut once the division is fixed. */
  requireOpenForEntries(divisionId: number): Division {
    const division = this.get(divisionId);
    if (division.status !== 'forming') {
      throw new ConflictError(`Division ${divisionId} is ${division.status}, not forming`, {
        divisionId,
        status: division.status,
      });
    }
    return division;
  }

  /** Fixtures ask this: a game belongs to a division whose entries are settled. */
  requireFixed(divisionId: number): Division {
    const division = this.get(divisionId);
    if (division.status === 'forming') {
      throw new ConflictError(`Division ${divisionId} has not fixed its entries yet`, {
        divisionId,
        status: division.status,
      });
    }
    return division;
  }
}
