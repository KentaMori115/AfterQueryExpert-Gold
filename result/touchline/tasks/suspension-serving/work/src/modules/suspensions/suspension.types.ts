/**
 * Serving a ban: which games a suspended player actually sat out.
 *
 * Discipline works out what a card is worth. This module works out what became
 * of it. Nothing here is stored: a ledger is derived every time from the cards
 * a player holds and the games their side has played, so rescinding a card or
 * settling a disputed score changes the answer the next time it is asked for,
 * with no second copy to drift.
 *
 * Three things about serving are easy to get backwards. A ban is served over
 * the games of the side the card was shown for, because that is the side whose
 * fixtures the player misses, and only a game that was actually played serves
 * anything. A straight ban starts with the very next game, but an accumulated
 * one waits a fortnight, because the league gives a club that long to claim
 * that a booking was wrongly recorded. And a player whose ban is still waiting
 * is not yet barred from anything: eligibility asks whether a game would serve
 * them a match, not whether they owe one.
 */
import { addDays } from '../../lib/days';
import type { Card } from '../discipline/discipline.types';
import type { Fixture } from '../fixtures/fixture.types';

/**
 * How long after a card an accumulated ban waits before a game can serve it.
 * A straight ban from a red card has no such wait.
 */
export const ACCUMULATION_WAIT_DAYS = 14;

/** One card that carried a ban, and how far its serving has got. */
export interface LedgerEntry {
  cardId: number;
  fixtureId: number;
  teamId: number;
  shownOn: string;
  matches: number;
  served: number;
  outstanding: number;
  /** The games that served it, in the order they did. */
  servedIn: number[];
  /** The day of the game that served the last match, once there is one. */
  clearedOn: string | null;
}

export interface SuspensionLedger {
  playerId: number;
  asOf: string;
  matchesBanned: number;
  matchesServed: number;
  matchesOutstanding: number;
  suspended: boolean;
  entries: LedgerEntry[];
}

/** Somebody who may not be picked for a game, and why. */
export interface IneligiblePlayer {
  playerId: number;
  clubId: number;
  teamId: number;
  outstanding: number;
}

export interface Eligibility {
  fixtureId: number;
  playedOn: string;
  /** The day the reading was taken on: the one before the game. */
  asOf: string;
  ineligible: IneligiblePlayer[];
}

/**
 * A ledger entry while it is being worked out. The two parts of the ban are
 * kept apart because they start on different days, and one served match comes
 * off both of them at once.
 */
export interface Serving {
  entry: LedgerEntry;
  straight: number;
  accumulated: number;
  /** The first day a game can serve the accumulated part. */
  accumulatedFrom: string;
}

/** The whole ban a card carries: the straight one and the accumulated one, served together. */
export function matchesFor(card: Card): number {
  return Math.max(card.straightBan, card.accumulationBan);
}

/** True when a card belongs in a ledger at all. A booking that cost only a fine does not. */
export function carriesBan(card: Card): boolean {
  return matchesFor(card) > 0;
}

/**
 * True when a game can serve a match. Only a game that was played counts: an
 * awarded game reaches the table but nobody sat it out, and a game that was
 * called off or abandoned was not missed by anybody.
 */
export function serves(fixture: Fixture): boolean {
  return fixture.status === 'played';
}

/** A card starts serving with the first game after the one it was shown in. */
export function shownBefore(card: LedgerEntry, fixture: Fixture): boolean {
  return card.shownOn < fixture.playedOn;
}

export function openServing(card: Card): Serving {
  const matches = matchesFor(card);
  return {
    entry: {
      cardId: card.id,
      fixtureId: card.fixtureId,
      teamId: card.teamId,
      shownOn: card.shownOn,
      matches,
      served: 0,
      outstanding: matches,
      servedIn: [],
      clearedOn: null,
    },
    straight: card.straightBan,
    accumulated: card.accumulationBan,
    accumulatedFrom: addDays(card.shownOn, ACCUMULATION_WAIT_DAYS),
  };
}

/**
 * Whether a match of this card falls due on a day: a game of the serving side
 * played that day would serve it.
 *
 * The straight part can be served by any game after the card. The accumulated
 * part only by a game on or after the day the wait runs out. Both parts are
 * paid off by the same served matches, so what is left of each is the part
 * less everything served so far.
 */
export function dueOn(serving: Serving, day: string): boolean {
  const { entry } = serving;
  if (entry.outstanding === 0 || entry.shownOn >= day) return false;
  if (serving.straight - entry.served > 0) return true;
  return serving.accumulated - entry.served > 0 && day >= serving.accumulatedFrom;
}

/** Whether this game, played by this side, serves a match of this card. */
export function canServe(serving: Serving, teamId: number, fixture: Fixture): boolean {
  return serving.entry.teamId === teamId && dueOn(serving, fixture.playedOn);
}

/**
 * Hands one side's games, in the order they were played, to the cards shown
 * for that side.
 *
 * Each played game serves one match, taken off the earliest card it can serve.
 * That is not always the earliest card outstanding: an accumulated ban still
 * inside its wait lets a game go past it to a later straight one. A game before
 * every card was shown serves nothing, and so does a game once every card is
 * clear. Servings are expected oldest first, the order the cards were shown in.
 */
export function serveGames(servings: Serving[], teamId: number, games: readonly Fixture[]): void {
  for (const game of games) {
    if (!serves(game)) continue;
    const serving = servings.find((candidate) => canServe(candidate, teamId, game));
    if (serving === undefined) continue;
    const { entry } = serving;
    entry.served += 1;
    entry.outstanding -= 1;
    entry.servedIn.push(game.id);
    if (entry.outstanding === 0) entry.clearedOn = game.playedOn;
  }
}

/** The sides a set of cards were shown for, each once, in the order they first appear. */
export function sidesOf(servings: readonly Serving[]): number[] {
  const seen: number[] = [];
  for (const serving of servings) {
    if (!seen.includes(serving.entry.teamId)) seen.push(serving.entry.teamId);
  }
  return seen;
}

/** Adds the entries up into the figures the ledger answers with. */
export function totalsOf(entries: readonly LedgerEntry[]): {
  matchesBanned: number;
  matchesServed: number;
  matchesOutstanding: number;
} {
  let matchesBanned = 0;
  let matchesServed = 0;
  let matchesOutstanding = 0;
  for (const entry of entries) {
    matchesBanned += entry.matches;
    matchesServed += entry.served;
    matchesOutstanding += entry.outstanding;
  }
  return { matchesBanned, matchesServed, matchesOutstanding };
}

/** Home side first, then by player, so two readings of the same game agree line for line. */
export function compareIneligible(
  left: IneligiblePlayer,
  right: IneligiblePlayer,
  homeTeamId: number,
): number {
  const leftHome = left.teamId === homeTeamId ? 0 : 1;
  const rightHome = right.teamId === homeTeamId ? 0 : 1;
  if (leftHome !== rightHome) return leftHome - rightHome;
  return left.playerId - right.playerId;
}
