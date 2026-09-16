/**
 * Every rule about reporting a score and getting it agreed.
 *
 * The rule that does the work: the side that answers a report cannot be the
 * side that made it. One club saying a game finished 4-0 proves nothing; the
 * other club agreeing, or refusing to, is what settles it.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import type { FixtureService } from '../fixtures/fixture.service';
import type { Fixture } from '../fixtures/fixture.types';
import { ResultRepository, type ResultFilter } from './result.repository';
import { RESULT_TRANSITIONS, type Result, type ResultStatus } from './result.types';

export interface ReportResult {
  homeGoals: number;
  awayGoals: number;
  reportedByTeamId: number;
  reportedOn: string;
}

export class ResultService {
  constructor(
    private readonly repo: ResultRepository,
    private readonly fixtures: FixtureService,
  ) {}

  private isInFixture(fixture: Fixture, teamId: number): boolean {
    return teamId === fixture.homeTeamId || teamId === fixture.awayTeamId;
  }

  report(fixtureId: number, input: ReportResult): Result {
    const fixture = this.fixtures.requireScheduled(fixtureId);
    if (this.repo.byFixture(fixtureId) !== undefined) {
      throw new ConflictError('That game already has a score reported against it', { fixtureId });
    }
    if (!this.isInFixture(fixture, input.reportedByTeamId)) {
      throw new ConflictError('Only a side that played can report the score', {
        fixtureId,
        reportedByTeamId: input.reportedByTeamId,
      });
    }
    const reportedOn = requireRealDay(input.reportedOn, 'reportedOn');
    if (isAfter(fixture.playedOn, reportedOn)) {
      throw new ConflictError('A score cannot be reported before the game was played', {
        playedOn: fixture.playedOn,
        reportedOn,
      });
    }
    return this.repo.insert({ fixtureId, ...input, reportedOn });
  }

  get(resultId: number): Result {
    const result = this.repo.byId(resultId);
    if (result === undefined) throw new NotFoundError(`There is no result ${resultId}`);
    return result;
  }

  forFixture(fixtureId: number): Result {
    this.fixtures.get(fixtureId);
    const result = this.repo.byFixture(fixtureId);
    if (result === undefined) {
      throw new NotFoundError(`No score has been reported for fixture ${fixtureId}`);
    }
    return result;
  }

  list(filter: ResultFilter): Result[] {
    return this.repo.list(filter);
  }

  private moveTo(result: Result, next: ResultStatus): void {
    if (!RESULT_TRANSITIONS[result.status].includes(next)) {
      throw new ConflictError(`A ${result.status} result cannot become ${next}`, {
        resultId: result.id,
        status: result.status,
      });
    }
  }

  /** The side answering has to be the one that did not report, and has to have played. */
  private requireOpponent(result: Result, teamId: number, action: string): Fixture {
    const fixture = this.fixtures.get(result.fixtureId);
    if (!this.isInFixture(fixture, teamId)) {
      throw new ConflictError(`Only a side that played can ${action} the score`, {
        resultId: result.id,
        teamId,
      });
    }
    if (teamId === result.reportedByTeamId) {
      throw new ConflictError(`The side that reported the score cannot ${action} it`, {
        resultId: result.id,
        teamId,
      });
    }
    return fixture;
  }

  confirm(resultId: number, input: { confirmedByTeamId: number; confirmedOn: string }): Result {
    const result = this.get(resultId);
    this.moveTo(result, 'confirmed');
    this.requireOpponent(result, input.confirmedByTeamId, 'confirm');
    const day = requireRealDay(input.confirmedOn, 'confirmedOn');
    if (isAfter(result.reportedOn, day)) {
      throw new ConflictError('A score cannot be agreed before it was reported', {
        reportedOn: result.reportedOn,
        confirmedOn: day,
      });
    }
    const confirmed = this.repo.update(resultId, {
      status: 'confirmed',
      answeredByTeamId: input.confirmedByTeamId,
      answeredOn: day,
    });
    this.fixtures.markPlayed(result.fixtureId);
    return confirmed;
  }

  dispute(
    resultId: number,
    input: { disputedByTeamId: number; disputedOn: string; note: string },
  ): Result {
    const result = this.get(resultId);
    this.moveTo(result, 'disputed');
    this.requireOpponent(result, input.disputedByTeamId, 'dispute');
    const day = requireRealDay(input.disputedOn, 'disputedOn');
    if (isAfter(result.reportedOn, day)) {
      throw new ConflictError('A score cannot be disputed before it was reported', {
        reportedOn: result.reportedOn,
        disputedOn: day,
      });
    }
    return this.repo.update(resultId, {
      status: 'disputed',
      answeredByTeamId: input.disputedByTeamId,
      answeredOn: day,
      note: input.note,
    });
  }

  /**
   * The league settles a disputed score itself, and the score it writes down
   * stands whether or not it matches what either side reported.
   */
  settle(
    resultId: number,
    input: { settledOn: string; homeGoals: number; awayGoals: number },
  ): Result {
    const result = this.get(resultId);
    if (result.status !== 'disputed') {
      throw new ConflictError('Only a disputed score needs settling', {
        resultId,
        status: result.status,
      });
    }
    const day = requireRealDay(input.settledOn, 'settledOn');
    if (result.answeredOn !== null && isAfter(result.answeredOn, day)) {
      throw new ConflictError('A dispute cannot be settled before it was raised', {
        disputedOn: result.answeredOn,
        settledOn: day,
      });
    }
    const settled = this.repo.update(resultId, {
      status: 'confirmed',
      homeGoals: input.homeGoals,
      awayGoals: input.awayGoals,
      settledOn: day,
    });
    this.fixtures.markPlayed(result.fixtureId);
    return settled;
  }

  /** The table asks for these: every score in a division that is beyond argument. */
  confirmedInDivision(divisionId: number): Result[] {
    return this.repo.confirmedInDivision(divisionId);
  }
}
