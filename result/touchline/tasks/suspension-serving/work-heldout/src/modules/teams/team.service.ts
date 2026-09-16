/**
 * Every rule about entering a team that could be argued about.
 *
 * Three of them are cross-entity, which is what makes this module the one that
 * catches most mistakes: the club has to be a member, the division has to still
 * be forming and have room, and the club's own teams have to stay in seniority
 * order across the whole season.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import type { ClubService } from '../clubs/club.service';
import type { DivisionService } from '../divisions/division.service';
import { TeamRepository, type TeamFilter } from './team.repository';
import { RANK_SENIORITY, type Team, type TeamRank } from './team.types';

export class TeamService {
  constructor(
    private readonly repo: TeamRepository,
    private readonly divisions: DivisionService,
    private readonly clubs: ClubService,
  ) {}

  /**
   * A club's senior side may never sit below one of its junior sides.
   *
   * Checked against every other team the club has in the same season, in both
   * directions, so it holds however the entries are ordered in time.
   */
  private checkSeniority(
    clubId: number,
    seasonId: number,
    rank: TeamRank,
    tier: number,
    exceptTeamId?: number,
  ): void {
    for (const other of this.repo.forClubInSeason(clubId, seasonId)) {
      if (other.id === exceptTeamId || other.status !== 'entered') continue;
      const otherDivision = this.divisions.get(other.divisionId);
      const senior = RANK_SENIORITY[rank] < RANK_SENIORITY[other.rank];
      const junior = RANK_SENIORITY[rank] > RANK_SENIORITY[other.rank];
      if (senior && tier > otherDivision.tier) {
        throw new ConflictError('A senior side cannot sit below a junior one', {
          rank,
          tier,
          otherRank: other.rank,
          otherTier: otherDivision.tier,
        });
      }
      if (junior && tier < otherDivision.tier) {
        throw new ConflictError('A junior side cannot sit above a senior one', {
          rank,
          tier,
          otherRank: other.rank,
          otherTier: otherDivision.tier,
        });
      }
    }
  }

  enter(divisionId: number, input: { clubId: number; rank: TeamRank; enteredOn: string }): Team {
    const division = this.divisions.requireOpenForEntries(divisionId);
    this.clubs.requireInGoodStanding(input.clubId);
    const enteredOn = requireRealDay(input.enteredOn, 'enteredOn');

    const existing = this.repo.byClubAndRankInSeason(input.clubId, input.rank, division.seasonId);
    if (existing !== undefined) {
      throw new ConflictError('That club already has a side of that rank this season', {
        clubId: input.clubId,
        rank: input.rank,
      });
    }
    const alreadyHere = this.repo.list({
      clubId: input.clubId,
      divisionId,
      status: 'entered',
    }).length;
    if (alreadyHere > 0) {
      throw new ConflictError('A club cannot put two sides in the same division', {
        clubId: input.clubId,
        divisionId,
      });
    }
    if (this.repo.countEnteredIn(divisionId) >= division.teamCapacity) {
      throw new ConflictError('That division is full', {
        divisionId,
        teamCapacity: division.teamCapacity,
      });
    }
    this.checkSeniority(input.clubId, division.seasonId, input.rank, division.tier);

    return this.repo.insert({ clubId: input.clubId, divisionId, rank: input.rank, enteredOn });
  }

  get(teamId: number): Team {
    const team = this.repo.byId(teamId);
    if (team === undefined) throw new NotFoundError(`There is no team ${teamId}`);
    return team;
  }

  list(filter: TeamFilter): Team[] {
    if (filter.divisionId !== undefined) this.divisions.get(filter.divisionId);
    if (filter.clubId !== undefined) this.clubs.get(filter.clubId);
    return this.repo.list(filter);
  }

  withdraw(teamId: number, withdrawnOn: string): Team {
    const team = this.get(teamId);
    if (team.status === 'withdrawn') {
      throw new ConflictError('That side has already withdrawn', { teamId });
    }
    const day = requireRealDay(withdrawnOn, 'withdrawnOn');
    if (isAfter(team.enteredOn, day)) {
      throw new ConflictError('A side cannot withdraw before it entered', {
        enteredOn: team.enteredOn,
        withdrawnOn: day,
      });
    }
    return this.repo.update(teamId, { status: 'withdrawn', withdrawnOn: day });
  }

  /** Moves a side to another division, which only happens while both are still forming. */
  move(teamId: number, divisionId: number): Team {
    const team = this.get(teamId);
    if (team.status !== 'entered') {
      throw new ConflictError('A side that has withdrawn cannot be moved', { teamId });
    }
    this.divisions.requireOpenForEntries(team.divisionId);
    const target = this.divisions.requireOpenForEntries(divisionId);
    if (target.id === team.divisionId) {
      throw new ConflictError('That side is already in that division', { teamId, divisionId });
    }
    const from = this.divisions.get(team.divisionId);
    if (from.seasonId !== target.seasonId) {
      throw new ConflictError('A side cannot move to a division in another season', {
        teamId,
        divisionId,
      });
    }
    if (this.repo.list({ clubId: team.clubId, divisionId, status: 'entered' }).length > 0) {
      throw new ConflictError('A club cannot put two sides in the same division', {
        clubId: team.clubId,
        divisionId,
      });
    }
    if (this.repo.countEnteredIn(divisionId) >= target.teamCapacity) {
      throw new ConflictError('That division is full', {
        divisionId,
        teamCapacity: target.teamCapacity,
      });
    }
    this.checkSeniority(team.clubId, target.seasonId, team.rank, target.tier, teamId);
    return this.repo.update(teamId, { divisionId });
  }

  /** Fixtures ask this: a game is between two sides that are still standing. */
  requireStanding(teamId: number): Team {
    const team = this.get(teamId);
    if (team.status !== 'entered') {
      throw new ConflictError(`Team ${teamId} has withdrawn`, { teamId });
    }
    return team;
  }
}
