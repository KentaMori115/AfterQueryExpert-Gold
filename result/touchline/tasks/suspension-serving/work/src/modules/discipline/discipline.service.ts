/**
 * Recording a card, and working out what it costs.
 *
 * The running total is written onto the card as it is recorded rather than
 * recomputed later, because the ban a card carries depends on where the player
 * stood at that moment. Rescinding a card afterwards therefore has to walk the
 * player's remaining cards again in order and rewrite what each one was worth:
 * taking a card away can undo a ban that a later card had already picked up.
 */
import { ConflictError, NotFoundError } from '../../lib/AppError';
import { isAfter, requireRealDay } from '../../lib/days';
import type { FixtureService } from '../fixtures/fixture.service';
import type { PlayerService } from '../players/player.service';
import type { SuspensionService } from '../suspensions/suspension.service';
import type { TeamService } from '../teams/team.service';
import { DisciplineRepository, type CardFilter } from './discipline.repository';
import {
  OFFENCE_TARIFF,
  STRAIGHT_RED_BAN,
  accumulationBanFor,
  type Card,
  type Offence,
} from './discipline.types';

export interface ShowCard {
  playerId: number;
  offence: Offence;
  shownOn: string;
}

export interface DisciplineRecord {
  playerId: number;
  clubId: number;
  asOf: string;
  cards: number;
  yellows: number;
  reds: number;
  points: number;
  finesPence: number;
  matchesBanned: number;
  standing: 'clear' | 'warned' | 'suspended';
}

export class DisciplineService {
  constructor(
    private readonly repo: DisciplineRepository,
    private readonly fixtures: FixtureService,
    private readonly players: PlayerService,
    private readonly teams: TeamService,
    private readonly suspensions: SuspensionService,
  ) {}

  show(fixtureId: number, input: ShowCard): Card {
    const fixture = this.fixtures.get(fixtureId);
    if (fixture.status === 'postponed') {
      throw new ConflictError('A game that was called off shows no cards', { fixtureId });
    }
    const player = this.players.requireRegistered(input.playerId);
    const shownOn = requireRealDay(input.shownOn, 'shownOn');
    if (shownOn !== fixture.playedOn) {
      throw new ConflictError('A card is shown on the day the game was played', {
        playedOn: fixture.playedOn,
        shownOn,
      });
    }

    // The player has to belong to one of the two clubs in this game.
    const home = this.teams.get(fixture.homeTeamId);
    const away = this.teams.get(fixture.awayTeamId);
    const side = [home, away].find((team) => team.clubId === player.clubId);
    if (side === undefined) {
      throw new ConflictError('That player is not at either club in this game', {
        fixtureId,
        playerId: input.playerId,
      });
    }

    const already = this.repo.inFixture(fixtureId, input.playerId);
    if (already.some((card) => card.colour === 'red')) {
      throw new ConflictError('That player has already been sent off in this game', {
        fixtureId,
        playerId: input.playerId,
      });
    }

    const tariff = OFFENCE_TARIFF[input.offence];
    const before = this.repo
      .forPlayer(input.playerId)
      .reduce((total, card) => total + card.points, 0);
    const after = before + tariff.points;

    return this.repo.insert({
      fixtureId,
      playerId: input.playerId,
      teamId: side.id,
      offence: input.offence,
      colour: tariff.colour,
      points: tariff.points,
      finePence: tariff.finePence,
      straightBan: STRAIGHT_RED_BAN[input.offence],
      accumulationBan: accumulationBanFor(before, after),
      runningPoints: after,
      shownOn,
    });
  }

  get(cardId: number): Card {
    const card = this.repo.byId(cardId);
    if (card === undefined) throw new NotFoundError(`There is no card ${cardId}`);
    return card;
  }

  list(filter: CardFilter): Card[] {
    if (filter.playerId !== undefined) this.players.get(filter.playerId);
    if (filter.teamId !== undefined) this.teams.get(filter.teamId);
    if (filter.fixtureId !== undefined) this.fixtures.get(filter.fixtureId);
    return this.repo.list(filter);
  }

  /**
   * Takes a card off a player's record and reworks everything that came after.
   *
   * The cards that follow keep their own points, but their running totals and
   * the bans those totals earned are worked out again from scratch, because a
   * threshold that was crossed may no longer be.
   */
  rescind(cardId: number, rescindedOn: string): Card {
    const card = this.get(cardId);
    if (card.status === 'rescinded') {
      throw new ConflictError('That card has already been rescinded', { cardId });
    }
    const day = requireRealDay(rescindedOn, 'rescindedOn');
    if (isAfter(card.shownOn, day)) {
      throw new ConflictError('A card cannot be rescinded before it was shown', {
        shownOn: card.shownOn,
        rescindedOn: day,
      });
    }

    const rescinded = this.repo.update(cardId, { status: 'rescinded', rescindedOn: day });
    this.rebuild(card.playerId);
    return rescinded;
  }

  /** Walks a player's standing cards in order and rewrites what each one was worth. */
  private rebuild(playerId: number): void {
    let running = 0;
    for (const card of this.repo.forPlayer(playerId)) {
      const before = running;
      running += card.points;
      const accumulation = accumulationBanFor(before, running);
      if (card.runningPoints !== running || card.accumulationBan !== accumulation) {
        this.repo.rewrite(card.id, running, accumulation);
      }
    }
  }

  /**
   * What a player's record adds up to on a given day.
   *
   * Bans are counted as matches rather than days, because a player serves them
   * over the games their side actually plays. `matchesBanned` is everything the
   * cards were worth; whether any of it is still being served is the serving
   * ledger's to say, and that is what the standing follows.
   */
  record(playerId: number, asOf: string): DisciplineRecord {
    const player = this.players.get(playerId);
    const day = requireRealDay(asOf, 'asOf');
    const cards = this.repo.forPlayerUpTo(playerId, day);

    let points = 0;
    let finesPence = 0;
    let matchesBanned = 0;
    let yellows = 0;
    let reds = 0;
    for (const card of cards) {
      points += card.points;
      finesPence += card.finePence;
      matchesBanned += Math.max(card.straightBan, card.accumulationBan);
      if (card.colour === 'red') reds += 1;
      else yellows += 1;
    }

    const outstanding = this.suspensions.outstanding(player.id, day);
    return {
      playerId: player.id,
      clubId: player.clubId,
      asOf: day,
      cards: cards.length,
      yellows,
      reds,
      points,
      finesPence,
      matchesBanned,
      standing: outstanding > 0 ? 'suspended' : points >= 3 ? 'warned' : 'clear',
    };
  }
}
