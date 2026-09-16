/**
 * Assembles a division's table from its confirmed results.
 *
 * There is no repository here because there is nothing to store: the table is
 * derived every time, from the fixtures and results that already exist. That is
 * deliberate. A stored table drifts the moment a disputed score is settled, and
 * the league would then have two answers to the same question.
 */
import { ConflictError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import type { ClubService } from '../clubs/club.service';
import type { DivisionService } from '../divisions/division.service';
import type { FixtureService } from '../fixtures/fixture.service';
import { awardedScoreline } from '../fixtures/fixture.types';
import type { ResultService } from '../results/result.service';
import type { SeasonService } from '../seasons/season.service';
import type { TeamService } from '../teams/team.service';
import {
  compareLines,
  emptyTally,
  formOf,
  goalDifference,
  placingFor,
  type FormLetter,
  type StandingLine,
  type Table,
  type Tally,
} from './standing.types';

export class StandingService {
  constructor(
    private readonly divisions: DivisionService,
    private readonly teams: TeamService,
    private readonly clubs: ClubService,
    private readonly fixtures: FixtureService,
    private readonly results: ResultService,
    private readonly seasons: SeasonService,
  ) {}

  /** Records one side's half of a game into its tally. */
  private record(
    tally: Tally,
    scored: number,
    conceded: number,
    opponentId: number,
    pointsWin: number,
    pointsDraw: number,
    pointsLoss: number,
  ): void {
    tally.played += 1;
    tally.goalsFor += scored;
    tally.goalsAgainst += conceded;

    let letter: FormLetter;
    let points: number;
    if (scored > conceded) {
      tally.won += 1;
      letter = 'W';
      points = pointsWin;
    } else if (scored < conceded) {
      tally.lost += 1;
      letter = 'L';
      points = pointsLoss;
    } else {
      tally.drawn += 1;
      letter = 'D';
      points = pointsDraw;
    }
    tally.points += points;
    // Newest first, because that is the order a form guide is read in.
    tally.form.unshift(letter);

    const seen = tally.against.get(opponentId) ?? { for: 0, against: 0, points: 0 };
    seen.for += scored;
    seen.against += conceded;
    seen.points += points;
    tally.against.set(opponentId, seen);
  }

  /**
   * The table as it stood at the end of `asOf`.
   *
   * Only games played on or before that day count, so the reading is
   * reproducible: asking for last month's table next year gives the same
   * answer it gave last month.
   */
  table(divisionId: number, asOf: string): Table {
    const division = this.divisions.get(divisionId);
    const season = this.seasons.get(division.seasonId);
    const day = requireRealDay(asOf, 'asOf');
    if (isAfter(season.startsOn, day)) {
      throw new ConflictError('A table cannot be asked for before the season starts', {
        startsOn: season.startsOn,
        asOf: day,
      });
    }

    const tallies = new Map<number, Tally>();
    for (const team of this.teams.list({ divisionId, status: 'entered' })) {
      const club = this.clubs.get(team.clubId);
      tallies.set(team.id, emptyTally(team.id, club.id, club.name, club.shortName, team.rank));
    }

    const scores = new Map<number, { homeGoals: number; awayGoals: number }>();
    for (const result of this.results.confirmedInDivision(divisionId)) {
      scores.set(result.fixtureId, { homeGoals: result.homeGoals, awayGoals: result.awayGoals });
    }

    let played = 0;
    let outstanding = 0;
    let goalsScored = 0;

    // In day order, so the form guide reads the way the season ran.
    for (const fixture of this.fixtures.list({ divisionId })) {
      if (isAfter(fixture.playedOn, day)) {
        outstanding += 1;
        continue;
      }
      const line = scores.get(fixture.id) ?? awardedScoreline(fixture);
      if (line === null || line === undefined) {
        outstanding += 1;
        continue;
      }

      const home = tallies.get(fixture.homeTeamId);
      const away = tallies.get(fixture.awayTeamId);
      played += 1;
      goalsScored += line.homeGoals + line.awayGoals;

      if (home !== undefined) {
        this.record(
          home,
          line.homeGoals,
          line.awayGoals,
          fixture.awayTeamId,
          season.pointsWin,
          season.pointsDraw,
          season.pointsLoss,
        );
      }
      if (away !== undefined) {
        this.record(
          away,
          line.awayGoals,
          line.homeGoals,
          fixture.homeTeamId,
          season.pointsWin,
          season.pointsDraw,
          season.pointsLoss,
        );
      }
    }

    const ordered = [...tallies.values()].sort(compareLines);
    const lines: StandingLine[] = ordered.map((tally, index) => ({
      position: index + 1,
      teamId: tally.teamId,
      clubId: tally.clubId,
      clubName: tally.clubName,
      shortName: tally.shortName,
      rank: tally.rank,
      played: tally.played,
      won: tally.won,
      drawn: tally.drawn,
      lost: tally.lost,
      goalsFor: tally.goalsFor,
      goalsAgainst: tally.goalsAgainst,
      goalDifference: goalDifference(tally),
      points: tally.points,
      form: formOf(tally),
      placing: placingFor(
        index + 1,
        ordered.length,
        division.promotionPlaces,
        division.relegationPlaces,
      ),
    }));

    return {
      divisionId: division.id,
      seasonId: division.seasonId,
      divisionName: division.name,
      tier: division.tier,
      asOf: day,
      played,
      outstanding,
      goalsScored,
      complete: outstanding === 0 && played > 0,
      lines,
    };
  }
}
