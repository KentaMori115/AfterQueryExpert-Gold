/**
 * Every rule about registering a player that could be argued about.
 *
 * The age check is settled against the day of registration rather than today,
 * so a registration that was legal when it happened does not become illegal
 * later. A squad number is only held by the players a club still has, so a
 * released player frees their number for somebody else.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import type { ClubService } from '../clubs/club.service';
import { PlayerRepository, type PlayerFilter } from './player.repository';
import {
  MAX_AGE_YEARS,
  MIN_AGE_YEARS,
  yearsBetween,
  type Player,
  type Position,
} from './player.types';

export interface RegisterPlayer {
  firstName: string;
  lastName: string;
  bornOn: string;
  position: Position;
  squadNumber: number;
  registeredOn: string;
}

export class PlayerService {
  constructor(
    private readonly repo: PlayerRepository,
    private readonly clubs: ClubService,
  ) {}

  private checkAge(bornOn: string, asOf: string): void {
    const years = yearsBetween(bornOn, asOf);
    if (years < MIN_AGE_YEARS) {
      throw new ConflictError(`A player must be ${MIN_AGE_YEARS} on the day they register`, {
        bornOn,
        asOf,
        years,
      });
    }
    if (years > MAX_AGE_YEARS) {
      throw new ConflictError(`A player may not be over ${MAX_AGE_YEARS}`, { bornOn, asOf, years });
    }
  }

  private checkNumberFree(clubId: number, squadNumber: number, exceptId?: number): void {
    const holder = this.repo.bySquadNumber(clubId, squadNumber);
    if (holder !== undefined && holder.id !== exceptId) {
      throw new ConflictError('Somebody at that club already wears that number', {
        clubId,
        squadNumber,
        playerId: holder.id,
      });
    }
  }

  register(clubId: number, input: RegisterPlayer): Player {
    this.clubs.requireInGoodStanding(clubId);
    const bornOn = requireRealDay(input.bornOn, 'bornOn');
    const registeredOn = requireRealDay(input.registeredOn, 'registeredOn');
    if (isAfter(bornOn, registeredOn)) {
      throw new ConflictError('A player cannot register before they were born', {
        bornOn,
        registeredOn,
      });
    }
    this.checkAge(bornOn, registeredOn);
    this.checkNumberFree(clubId, input.squadNumber);
    return this.repo.insert({ clubId, ...input, bornOn, registeredOn });
  }

  get(playerId: number): Player {
    const player = this.repo.byId(playerId);
    if (player === undefined) throw new NotFoundError(`There is no player ${playerId}`);
    return player;
  }

  list(filter: PlayerFilter): Player[] {
    if (filter.clubId !== undefined) this.clubs.get(filter.clubId);
    return this.repo.list(filter);
  }

  update(
    playerId: number,
    changes: {
      firstName?: string;
      lastName?: string;
      position?: Position;
      squadNumber?: number;
    },
  ): Player {
    const player = this.get(playerId);
    if (player.status === 'released') {
      throw new ConflictError('A released player cannot be changed', { playerId });
    }
    if (changes.squadNumber !== undefined) {
      this.checkNumberFree(player.clubId, changes.squadNumber, playerId);
    }
    return this.repo.update(playerId, changes);
  }

  release(playerId: number, releasedOn: string): Player {
    const player = this.get(playerId);
    if (player.status === 'released') {
      throw new ConflictError('That player has already been released', { playerId });
    }
    const day = requireRealDay(releasedOn, 'releasedOn');
    if (isAfter(player.registeredOn, day)) {
      throw new ConflictError('A player cannot be released before they registered', {
        registeredOn: player.registeredOn,
        releasedOn: day,
      });
    }
    return this.repo.update(playerId, { status: 'released', releasedOn: day });
  }

  /**
   * Moves a registered player to another club.
   *
   * The record stays one person: the club changes, the day they joined the new
   * club replaces the old registration day, and the number they will wear there
   * has to be free at the receiving club rather than at the one they left.
   */
  transfer(
    playerId: number,
    input: { clubId: number; transferredOn: string; squadNumber: number },
  ): Player {
    const player = this.get(playerId);
    if (player.status === 'released') {
      throw new ConflictError('A released player cannot be transferred', { playerId });
    }
    if (input.clubId === player.clubId) {
      throw new ConflictError('That player is already at that club', {
        playerId,
        clubId: input.clubId,
      });
    }
    this.clubs.requireInGoodStanding(input.clubId);
    const day = requireRealDay(input.transferredOn, 'transferredOn');
    if (isAfter(player.registeredOn, day)) {
      throw new ConflictError('A transfer cannot precede the registration it replaces', {
        registeredOn: player.registeredOn,
        transferredOn: day,
      });
    }
    this.checkAge(player.bornOn, day);
    this.checkNumberFree(input.clubId, input.squadNumber);
    return this.repo.update(playerId, {
      clubId: input.clubId,
      squadNumber: input.squadNumber,
      registeredOn: day,
    });
  }

  /** Discipline asks this: a card is only recorded against somebody a club still has. */
  requireRegistered(playerId: number): Player {
    const player = this.get(playerId);
    if (player.status !== 'registered') {
      throw new ConflictError(`Player ${playerId} has been released`, { playerId });
    }
    return player;
  }
}
