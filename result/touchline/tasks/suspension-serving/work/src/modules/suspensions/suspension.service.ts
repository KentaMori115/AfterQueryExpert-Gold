/**
 * Assembles a player's serving ledger, and reads who may not play in a game.
 *
 * There is no repository here because there is nothing to store. The cards
 * are discipline's, the games are the fixture book's, and the ledger is what
 * the two say together on the day asked about.
 */
import { addDays, isAfter, requireRealDay } from '../../lib/days';
import type { DisciplineRepository } from '../discipline/discipline.repository';
import type { FixtureService } from '../fixtures/fixture.service';
import type { Fixture } from '../fixtures/fixture.types';
import type { PlayerService } from '../players/player.service';
import type { TeamService } from '../teams/team.service';
import {
  carriesBan,
  compareIneligible,
  dueOn,
  openServing,
  serveGames,
  sidesOf,
  totalsOf,
  type Eligibility,
  type IneligiblePlayer,
  type Serving,
  type SuspensionLedger,
} from './suspension.types';

export class SuspensionService {
  constructor(
    private readonly cards: DisciplineRepository,
    private readonly fixtures: FixtureService,
    private readonly players: PlayerService,
    private readonly teams: TeamService,
  ) {}

  /**
   * Every ban a player had picked up by `asOf`, and how much of each had been
   * served by then.
   *
   * The day cuts twice. A card shown after it is not in the reading, and a
   * game played after it has served nothing yet. Rescinded cards are not
   * standing, so they are not here either, and the games they had been using
   * fall through to whatever comes next.
   */
  ledger(playerId: number, asOf: string): SuspensionLedger {
    const player = this.players.get(playerId);
    const day = requireRealDay(asOf, 'asOf');

    const entries = this.servingsFor(player.id, day).map((serving) => serving.entry);
    const totals = totalsOf(entries);
    return {
      playerId: player.id,
      asOf: day,
      ...totals,
      suspended: totals.matchesOutstanding > 0,
      entries,
    };
  }

  /** Discipline asks this for a record's standing: how many matches were still to serve on a day. */
  outstanding(playerId: number, asOf: string): number {
    return this.ledger(playerId, asOf).matchesOutstanding;
  }

  /** Every card of the player's that carried a ban up to the day, served as far as the day allows. */
  private servingsFor(playerId: number, day: string): Serving[] {
    const servings = this.cards.forPlayerUpTo(playerId, day).filter(carriesBan).map(openServing);
    for (const teamId of sidesOf(servings)) {
      // Every game of the side up to the day, whatever became of it. Which of
      // them serve a match is the ledger's rule, not the fixture filter's.
      const games = this.fixtures.list({ teamId }).filter((game) => !isAfter(game.playedOn, day));
      serveGames(servings, teamId, games);
    }
    return servings;
  }

  /**
   * How many matches a player still owes if one of them falls due on the day
   * of this game, given everything up to the day before it; zero when none
   * does. Owing a match is not enough to be barred: an accumulated ban still
   * inside its wait leaves the player free to play. Which side the game is
   * does not come into it, because a due match bars the player from every
   * side of the club, though only the serving side's game pays it off.
   */
  private wouldServe(playerId: number, fixture: Fixture, eve: string): number {
    const servings = this.servingsFor(playerId, eve);
    if (!servings.some((serving) => dueOn(serving, fixture.playedOn))) return 0;
    return servings.reduce((total, serving) => total + serving.entry.outstanding, 0);
  }

  /**
   * Who in either side may not play in a game.
   *
   * The reading is taken the day before, so the game itself, whatever happens
   * in it, cannot change who was allowed to start it. Everybody a club still
   * has registered is looked at, whichever of its sides the ban was earned
   * with, because a suspended player is suspended from the whole club. A
   * player is barred when the game would serve them a match; a ban that is
   * still waiting bars nobody yet.
   */
  eligibility(fixtureId: number): Eligibility {
    const fixture = this.fixtures.get(fixtureId);
    const asOf = addDays(fixture.playedOn, -1);

    const ineligible: IneligiblePlayer[] = [];
    for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
      const side = this.teams.get(teamId);
      for (const player of this.players.list({ clubId: side.clubId, status: 'registered' })) {
        const outstanding = this.wouldServe(player.id, fixture, asOf);
        if (outstanding === 0) continue;
        ineligible.push({ playerId: player.id, clubId: side.clubId, teamId: side.id, outstanding });
      }
    }
    ineligible.sort((left, right) => compareIneligible(left, right, fixture.homeTeamId));

    return { fixtureId: fixture.id, playedOn: fixture.playedOn, asOf, ineligible };
  }
}
