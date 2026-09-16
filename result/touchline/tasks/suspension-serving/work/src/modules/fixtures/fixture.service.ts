/**
 * Every rule about when and where a game is played.
 *
 * The checks that catch most mistakes are the ones that look outside the
 * fixture being scheduled: how many times these two have already been drawn,
 * how many games the ground already holds that day, and whether either side is
 * already playing somewhere else.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import type { DivisionService } from '../divisions/division.service';
import { roundsFor } from '../divisions/division.types';
import type { SeasonService } from '../seasons/season.service';
import type { TeamService } from '../teams/team.service';
import type { VenueService } from '../venues/venue.service';
import { dailyCapacity } from '../venues/venue.types';
import { FixtureRepository, type FixtureFilter } from './fixture.repository';
import {
  FIXTURE_TRANSITIONS,
  needsFloodlights,
  type AwardReason,
  type Fixture,
  type FixtureStatus,
} from './fixture.types';

export interface ScheduleFixture {
  homeTeamId: number;
  awayTeamId: number;
  venueId: number;
  playedOn: string;
  kickOff: string;
}

export class FixtureService {
  constructor(
    private readonly repo: FixtureRepository,
    private readonly divisions: DivisionService,
    private readonly teams: TeamService,
    private readonly venues: VenueService,
    private readonly seasons: SeasonService,
  ) {}

  /** Everything that has to hold about a day, a time and a ground, wherever it is set. */
  private checkSlot(
    divisionId: number,
    venueId: number,
    playedOn: string,
    kickOff: string,
    homeTeamId: number,
    awayTeamId: number,
    exceptId?: number,
  ): void {
    const division = this.divisions.get(divisionId);
    const season = this.seasons.get(division.seasonId);
    if (isAfter(season.startsOn, playedOn) || isAfter(playedOn, season.endsOn)) {
      throw new ConflictError('A game has to fall inside the season it belongs to', {
        startsOn: season.startsOn,
        endsOn: season.endsOn,
        playedOn,
      });
    }

    const venue = this.venues.requireOpen(venueId);
    if (needsFloodlights(kickOff) && !venue.floodlit) {
      throw new ConflictError('That ground cannot be lit for a kick-off that late', {
        venueId,
        kickOff,
      });
    }
    if (this.repo.countAtVenueOn(venueId, playedOn, exceptId) >= dailyCapacity(venue)) {
      throw new ConflictError('That ground already holds as many games as it can that day', {
        venueId,
        playedOn,
        capacity: dailyCapacity(venue),
      });
    }
    for (const teamId of [homeTeamId, awayTeamId]) {
      if (this.repo.forTeamOn(teamId, playedOn, exceptId).length > 0) {
        throw new ConflictError('One of those sides is already playing that day', {
          teamId,
          playedOn,
        });
      }
    }
  }

  schedule(divisionId: number, input: ScheduleFixture): Fixture {
    const division = this.divisions.requireFixed(divisionId);
    if (division.status === 'completed') {
      throw new ConflictError('A completed division takes no more games', { divisionId });
    }
    if (input.homeTeamId === input.awayTeamId) {
      throw new ConflictError('A side cannot play itself', { teamId: input.homeTeamId });
    }

    const home = this.teams.requireStanding(input.homeTeamId);
    const away = this.teams.requireStanding(input.awayTeamId);
    for (const team of [home, away]) {
      if (team.divisionId !== divisionId) {
        throw new ConflictError('Both sides have to be in the division the game belongs to', {
          teamId: team.id,
          divisionId,
        });
      }
    }

    const playedOn = requireRealDay(input.playedOn, 'playedOn');
    const rounds = roundsFor(division.teamCapacity);
    const met = this.repo.meetingsBetween(divisionId, input.homeTeamId, input.awayTeamId);
    if (met.length >= rounds) {
      throw new ConflictError('Those two have already been drawn as often as the division plays', {
        rounds,
        alreadyDrawn: met.length,
      });
    }
    const sameWayRound = met.filter((game) => game.homeTeamId === input.homeTeamId).length;
    if (sameWayRound >= rounds / 2) {
      throw new ConflictError('That side has already been drawn at home against these opponents', {
        homeTeamId: input.homeTeamId,
        awayTeamId: input.awayTeamId,
      });
    }

    this.checkSlot(
      divisionId,
      input.venueId,
      playedOn,
      input.kickOff,
      input.homeTeamId,
      input.awayTeamId,
    );

    return this.repo.insert({ divisionId, ...input, playedOn });
  }

  get(fixtureId: number): Fixture {
    const fixture = this.repo.byId(fixtureId);
    if (fixture === undefined) throw new NotFoundError(`There is no fixture ${fixtureId}`);
    return fixture;
  }

  list(filter: FixtureFilter): Fixture[] {
    if (filter.divisionId !== undefined) this.divisions.get(filter.divisionId);
    if (filter.teamId !== undefined) this.teams.get(filter.teamId);
    if (filter.venueId !== undefined) this.venues.get(filter.venueId);
    if (filter.playedOn !== undefined) requireRealDay(filter.playedOn, 'playedOn');
    return this.repo.list(filter);
  }

  private moveTo(fixture: Fixture, next: FixtureStatus): void {
    if (!FIXTURE_TRANSITIONS[fixture.status].includes(next)) {
      throw new ConflictError(`A ${fixture.status} fixture cannot become ${next}`, {
        fixtureId: fixture.id,
        status: fixture.status,
      });
    }
  }

  postpone(fixtureId: number, postponedOn: string): Fixture {
    const fixture = this.get(fixtureId);
    this.moveTo(fixture, 'postponed');
    const day = requireRealDay(postponedOn, 'postponedOn');
    if (isAfter(day, fixture.playedOn)) {
      throw new ConflictError('A game cannot be called off after it was due to be played', {
        playedOn: fixture.playedOn,
        postponedOn: day,
      });
    }
    return this.repo.update(fixtureId, { status: 'postponed', postponedOn: day });
  }

  abandon(fixtureId: number, abandonedOn: string): Fixture {
    const fixture = this.get(fixtureId);
    this.moveTo(fixture, 'abandoned');
    const day = requireRealDay(abandonedOn, 'abandonedOn');
    if (isAfter(fixture.playedOn, day)) {
      throw new ConflictError('A game cannot be abandoned before it kicked off', {
        playedOn: fixture.playedOn,
        abandonedOn: day,
      });
    }
    return this.repo.update(fixtureId, { status: 'abandoned' });
  }

  /** Puts a called-off game back in the book on a new day, and possibly a new ground. */
  reschedule(
    fixtureId: number,
    input: { playedOn: string; kickOff: string; venueId?: number },
  ): Fixture {
    const fixture = this.get(fixtureId);
    this.moveTo(fixture, 'scheduled');
    const playedOn = requireRealDay(input.playedOn, 'playedOn');
    const venueId = input.venueId ?? fixture.venueId;
    this.checkSlot(
      fixture.divisionId,
      venueId,
      playedOn,
      input.kickOff,
      fixture.homeTeamId,
      fixture.awayTeamId,
      fixtureId,
    );
    return this.repo.update(fixtureId, {
      status: 'scheduled',
      playedOn,
      kickOff: input.kickOff,
      venueId,
      postponedOn: null,
    });
  }

  /** Hands the game to one side without it being played. The score comes from the reason. */
  award(
    fixtureId: number,
    input: { awardedOn: string; awardedToTeamId: number; reason: AwardReason },
  ): Fixture {
    const fixture = this.get(fixtureId);
    this.moveTo(fixture, 'awarded');
    requireRealDay(input.awardedOn, 'awardedOn');
    if (
      input.awardedToTeamId !== fixture.homeTeamId &&
      input.awardedToTeamId !== fixture.awayTeamId
    ) {
      throw new ConflictError('A game can only be awarded to one of the two sides in it', {
        fixtureId,
        awardedToTeamId: input.awardedToTeamId,
      });
    }
    return this.repo.update(fixtureId, {
      status: 'awarded',
      awardedToTeamId: input.awardedToTeamId,
      awardReason: input.reason,
    });
  }

  /** Results asks this: a score is only reported against a game still waiting for one. */
  requireScheduled(fixtureId: number): Fixture {
    const fixture = this.get(fixtureId);
    if (fixture.status !== 'scheduled') {
      throw new ConflictError(`Fixture ${fixtureId} is ${fixture.status}, not scheduled`, {
        fixtureId,
        status: fixture.status,
      });
    }
    return fixture;
  }

  /** Results tells the fixture the score has stuck. */
  markPlayed(fixtureId: number): Fixture {
    const fixture = this.get(fixtureId);
    this.moveTo(fixture, 'played');
    return this.repo.update(fixtureId, { status: 'played' });
  }
}
