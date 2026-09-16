/**
 * Every rule about a club that could be argued about.
 *
 * The transitions are the point: a club applies, is admitted, may be suspended
 * and reinstated any number of times, and once it resigns it is finished. A
 * suspended club keeps its record but cannot enter anything new.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import type { VenueService } from '../venues/venue.service';
import { ClubRepository, type ClubFilter } from './club.repository';
import { CLUB_TRANSITIONS, type Club, type ClubStatus } from './club.types';

export interface CreateClub {
  name: string;
  shortName: string;
  foundedYear: number;
  contactEmail: string;
  appliedOn: string;
  homeVenueId?: number;
}

export class ClubService {
  constructor(
    private readonly repo: ClubRepository,
    private readonly venues: VenueService,
  ) {}

  create(input: CreateClub): Club {
    const appliedOn = requireRealDay(input.appliedOn, 'appliedOn');
    if (this.repo.byName(input.name) !== undefined) {
      throw new ConflictError('There is already a club by that name', { name: input.name });
    }
    if (this.repo.byShortName(input.shortName) !== undefined) {
      throw new ConflictError('Another club already uses those letters', {
        shortName: input.shortName,
      });
    }
    if (input.homeVenueId !== undefined) {
      this.venues.requireOpen(input.homeVenueId);
    }
    return this.repo.insert({
      name: input.name,
      shortName: input.shortName,
      foundedYear: input.foundedYear,
      contactEmail: input.contactEmail,
      homeVenueId: input.homeVenueId ?? null,
      appliedOn,
    });
  }

  get(clubId: number): Club {
    const club = this.repo.byId(clubId);
    if (club === undefined) throw new NotFoundError(`There is no club ${clubId}`);
    return club;
  }

  list(filter: ClubFilter): Club[] {
    if (filter.homeVenueId !== undefined) this.venues.get(filter.homeVenueId);
    return this.repo.list(filter);
  }

  update(
    clubId: number,
    changes: { name?: string; contactEmail?: string; homeVenueId?: number | null },
  ): Club {
    const club = this.get(clubId);
    if (club.status === 'resigned') {
      throw new ConflictError('A club that has resigned cannot be changed', { clubId });
    }
    if (changes.name !== undefined) {
      const other = this.repo.byName(changes.name);
      if (other !== undefined && other.id !== clubId) {
        throw new ConflictError('There is already a club by that name', { name: changes.name });
      }
    }
    if (changes.homeVenueId !== undefined && changes.homeVenueId !== null) {
      this.venues.requireOpen(changes.homeVenueId);
    }
    return this.repo.update(clubId, changes);
  }

  private moveTo(club: Club, next: ClubStatus): void {
    if (!CLUB_TRANSITIONS[club.status].includes(next)) {
      throw new ConflictError(`A ${club.status} club cannot become ${next}`, {
        clubId: club.id,
        status: club.status,
      });
    }
  }

  /**
   * Admitting and reinstating both end at `member`, so the transition table
   * cannot tell them apart on its own. Each names the standing it starts from:
   * an applicant is admitted, a suspended club is reinstated, and neither word
   * is allowed to do the other one's job.
   */
  private requireStanding(club: Club, expected: ClubStatus, action: string): void {
    if (club.status !== expected) {
      throw new ConflictError(`Only a ${expected} club can be ${action}`, {
        clubId: club.id,
        status: club.status,
      });
    }
  }

  admit(clubId: number, admittedOn: string): Club {
    const club = this.get(clubId);
    this.requireStanding(club, 'applied', 'admitted');
    this.moveTo(club, 'member');
    const day = requireRealDay(admittedOn, 'admittedOn');
    if (isAfter(club.appliedOn, day)) {
      throw new ConflictError('A club cannot be admitted before it applied', {
        appliedOn: club.appliedOn,
        admittedOn: day,
      });
    }
    return this.repo.update(clubId, { status: 'member', admittedOn: day });
  }

  suspend(clubId: number, suspendedOn: string): Club {
    const club = this.get(clubId);
    this.moveTo(club, 'suspended');
    const day = requireRealDay(suspendedOn, 'suspendedOn');
    if (club.admittedOn !== null && isAfter(club.admittedOn, day)) {
      throw new ConflictError('A club cannot be suspended before it was admitted', {
        admittedOn: club.admittedOn,
        suspendedOn: day,
      });
    }
    return this.repo.update(clubId, { status: 'suspended' });
  }

  reinstate(clubId: number, reinstatedOn: string): Club {
    const club = this.get(clubId);
    this.requireStanding(club, 'suspended', 'reinstated');
    this.moveTo(club, 'member');
    const day = requireRealDay(reinstatedOn, 'reinstatedOn');
    if (club.admittedOn !== null && isAfter(club.admittedOn, day)) {
      throw new ConflictError('A club cannot be reinstated before it was admitted', {
        admittedOn: club.admittedOn,
        reinstatedOn: day,
      });
    }
    return this.repo.update(clubId, { status: 'member' });
  }

  resign(clubId: number, leftOn: string): Club {
    const club = this.get(clubId);
    this.moveTo(club, 'resigned');
    const day = requireRealDay(leftOn, 'leftOn');
    if (isAfter(club.appliedOn, day)) {
      throw new ConflictError('A club cannot leave before it applied', {
        appliedOn: club.appliedOn,
        leftOn: day,
      });
    }
    return this.repo.update(clubId, { status: 'resigned', leftOn: day });
  }

  /** Teams and players ask this before letting a club enter anything. */
  requireInGoodStanding(clubId: number): Club {
    const club = this.get(clubId);
    if (club.status !== 'member') {
      throw new ConflictError(`Club ${clubId} is ${club.status}, not a member`, {
        clubId,
        status: club.status,
      });
    }
    return club;
  }
}
