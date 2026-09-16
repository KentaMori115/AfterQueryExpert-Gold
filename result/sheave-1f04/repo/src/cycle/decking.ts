/**
 * The standing time, worked out from what happens at the two landings
 * rather than taken on trust.
 *
 * Every other figure in a winding cycle comes out of the machine: the
 * speed it runs at, the rate it gets up to that speed, the length of
 * the shaft it runs in. The standing time does not. It comes off a
 * landing, where men change tubs on a cage one deck at a time, and in a
 * shallow shaft it is the largest single item in the cycle and the only
 * one nobody has measured.
 *
 * A cage stands while each of its decks is changed, and stands again
 * between decks, because the second deck cannot be reached until the
 * cage has been lifted a deck's height and set back on the keps. So
 * decks are not free: they are bought in payload and paid for in
 * seconds, and which of the two wins is a question about the shaft
 * rather than about the cage. Below the rope's allowance the deck wins
 * as soon as the wind takes longer than one move between decks, which
 * every shaft of any consequence does.
 *
 * Above that allowance it loses, and loses twice over: a cage built
 * with a deck it cannot fill is a heavier cage, and a heavier cage is
 * allowed less payload on the same rope than the lighter one it
 * replaced. That is the whole of the argument against the five-deck
 * cages a few collieries built and none of them kept.
 *
 * A skip has no decks to change. It fills from a measuring pocket and
 * empties over a flap, each in the time it takes to work one, and a
 * counterweight is never loaded at all. Both of those times can be
 * nought, because a pit that has put a tippler under the headgear has
 * bought exactly that, and neither can be less.
 */

import { insist, count, nonNegative, positive, within } from "../errors.ts";
import { round } from "../units/round.ts";
import { type Conveyance, A_TUB, CAGE_TARE, conveyance, payloadAllowed } from "../cage/index.ts";
import { type Profile, cycleTime, profile, tonnesAnHour } from "./kinematics.ts";

/** How long a full tub takes off a deck and an empty one on, in seconds. */
export const A_TUB_TAKES = 6;

/** How many tubs stand on one deck. */
export const TUBS_A_DECK = 2;

/** How far it is from one deck to the next, in metres. */
export const DECK_PITCH = 2.4;

/** How long the keps take, in seconds, at each stop between decks. */
export const SETTLING = 4;

/** How long a skip takes to fill or to empty, in seconds. */
export const DISCHARGE = 12;

/** The most decks anybody ever built into a cage. */
export const MOST_DECKS = 6;

/** How a conveyance is emptied and filled at one end of the wind. */
export interface Decking {
  /** Seconds to draw a full tub off a deck and push an empty one on. */
  readonly perTub: number;
  /** How many tubs stand on one deck. */
  readonly tubsADeck: number;
  /** Metres from one deck to the next. */
  readonly pitch: number;
  /** Seconds the keps take at each stop between decks. */
  readonly settle: number;
  /** Seconds a skip takes to fill or to empty. */
  readonly discharge: number;
}

/** An arrangement, checked. */
export function decking(over: Partial<Decking> = {}): Decking {
  const found: Decking = {
    perTub: over.perTub ?? A_TUB_TAKES,
    tubsADeck: over.tubsADeck ?? TUBS_A_DECK,
    pitch: over.pitch ?? DECK_PITCH,
    settle: over.settle ?? SETTLING,
    discharge: over.discharge ?? DISCHARGE,
  };
  positive(found.perTub, "perTub");
  count(found.tubsADeck, "tubsADeck");
  positive(found.tubsADeck, "tubsADeck");
  positive(found.pitch, "pitch");
  nonNegative(found.settle, "settle");
  nonNegative(found.discharge, "discharge");
  return found;
}

/**
 * How long one deck takes to change, in seconds.
 *
 * The tubs come off and go on one at a time, so a deck holding three of
 * them takes half as long again as a deck holding two. Nothing here is
 * clever: it is a number of tubs and a number of seconds a tub, and it
 * is the figure a stopwatch on the landing gives.
 */
export function deckChange(one: Decking): number {
  return round(one.perTub * one.tubsADeck, 1);
}

/**
 * The move from one deck to the next, in seconds.
 *
 * The cage lifts a deck's height at creep speed and is set back on the
 * keps. It is the item that makes a fourth deck worth less than a
 * second one, and on a winder whose creep is slow it is the item that
 * makes the fourth deck worth nothing.
 */
export function deckMove(one: Decking, creep: number): number {
  positive(creep, "creep");
  return round(one.pitch / creep + one.settle, 1);
}

/** Every move a cage of a stated number of decks makes, in seconds. */
export function redecking(one: Decking, decks: number, creep: number): number {
  count(decks, "decks");
  within(decks, 1, MOST_DECKS, "decks");
  return round((decks - 1) * deckMove(one, creep), 1);
}

/**
 * How long a conveyance stands at one end of the wind, in seconds.
 *
 * A cage stands for each deck it has and for each move between them. A
 * skip stands while it fills or empties, whatever its decks are said to
 * be, because a skip is one vessel and the number on the sheet is a
 * formality. A counterweight stands for nothing: nobody loads it and
 * nobody waits for it.
 */
export function standAt(one: Decking, what: Conveyance, creep: number): number {
  if (what.kind === "counterweight") return 0;
  if (what.kind === "skip") return round(one.discharge, 1);
  return round(what.decks * deckChange(one) + redecking(one, what.decks, creep), 1);
}

/**
 * What the winder stands between two winds, in seconds.
 *
 * Both landings are worked at once. The loaded conveyance is changed at
 * the bank while the empty one is filled at the pit bottom, so the
 * winder waits for the slower of the two and not for the pair of them —
 * which is why a colliery that has put a tippler at the top and left
 * men with shovels at the bottom has bought itself nothing.
 */
export function stand(one: Decking, rising: Conveyance, falling: Conveyance, creep: number): number {
  return Math.max(standAt(one, rising, creep), standAt(one, falling, creep));
}

/**
 * The same profile, standing for as long as its landings take.
 *
 * Everything else about the wind is left where it was. A profile is a
 * description of a machine, and an arrangement of tubs settles exactly
 * one figure in it.
 *
 * It is the join between the two halves of a cycle and it only goes one
 * way. The landing settles the standing time; the standing time never
 * settles anything about the landing, because the men changing tubs
 * cannot see the winder and would not go faster if they could.
 */
export function withDecking(how: Profile, one: Decking, rising: Conveyance, falling: Conveyance): Profile {
  return profile({ ...how, rest: stand(one, rising, falling, how.creep) });
}

/**
 * What the decks of a cage hold, in kilograms, before the rope has had
 * its say.
 *
 * Tubs and nothing else. A deck holds what stands on it, the tubs are
 * the same tubs on every deck, and a cage is therefore linear in its
 * decks in a way that almost nothing else about a winding installation
 * is.
 */
export function deckPayload(one: Decking, decks: number, aTub = A_TUB): number {
  count(decks, "decks");
  within(decks, 1, MOST_DECKS, "decks");
  positive(aTub, "aTub");
  return round(decks * one.tubsADeck * aTub, 1);
}

/**
 * A cage built to a stated number of decks and filled to what the rope
 * allows.
 *
 * The tare is what a cage of that many decks weighs, which is the
 * library's fitted ratio against the coal those decks hold — so the
 * tare is settled by the steel and not by what happens to be in it. The
 * payload is the smaller of what the decks hold and what the rope will
 * carry once that tare is off it, which is why the deck a rope cannot
 * fill is worse than no deck at all.
 */
export function deckedCage(one: Decking, decks: number, allowed: number, aTub = A_TUB): Conveyance {
  const held = deckPayload(one, decks, aTub);
  const built = conveyance({
    name: `a ${decks} deck cage`,
    kind: "cage",
    tare: round(CAGE_TARE * held, 1),
    payload: held,
    decks,
    width: 2.6,
    across: 1.5,
  });
  const room = payloadAllowed(built, allowed);
  return room >= held ? built : conveyance({ ...built, payload: round(room, 1) });
}

/**
 * The most decks a stated rope will carry the tubs of.
 *
 * Each deck adds its own coal and three times as much again in steel,
 * so the count runs out sooner than anybody sizing a cage on payload
 * alone expects. A rope that will not lift a single deck's cage is
 * refused rather than answered with nought, because a winder with no
 * conveyance on it is not an arrangement anybody can work with.
 */
export function decksAllowed(one: Decking, allowed: number, aTub = A_TUB): number {
  positive(allowed, "allowed");
  let found = 0;
  for (let decks = 1; decks <= MOST_DECKS; decks += 1) {
    const held = deckPayload(one, decks, aTub);
    const cage = deckedCage(one, decks, allowed, aTub);
    if (cage.payload < held) break;
    found = decks;
  }
  insist(found > 0, `${allowed} kN will not carry a cage of one deck and its coal`, "allowed");
  return found;
}

/**
 * What a winder raises an hour on a stated number of decks, in tonnes.
 *
 * The cage is built to the decks, the standing time comes from the
 * decks, and the two pull against each other: the payload rises in a
 * straight line until the rope stops it, and the winds an hour come
 * down the whole way.
 */
export function raises(
  how: Profile,
  one: Decking,
  decks: number,
  distance: number,
  allowed: number,
  aTub = A_TUB,
): number {
  const loaded = deckedCage(one, decks, allowed, aTub);
  const empty = conveyance({ ...loaded, name: "the empty cage", payload: 0 });
  return tonnesAnHour(withDecking(how, one, loaded, empty), distance, loaded.payload);
}

/**
 * The number of decks that raises the most coal.
 *
 * Walked rather than solved, because the walk is four steps long and a
 * colliery choosing between two decks and three wants both figures on
 * the sheet anyway. Where two counts raise the same the lower one wins:
 * a deck that buys nothing is a deck of steel, a deck of headroom and a
 * deck of standing time waiting to go wrong.
 */
export function bestDecks(
  how: Profile,
  one: Decking,
  distance: number,
  allowed: number,
  most = 4,
  aTub = A_TUB,
): number {
  count(most, "most");
  within(most, 1, MOST_DECKS, "most");
  let best = 1;
  let raised = raises(how, one, 1, distance, allowed, aTub);
  for (let decks = 2; decks <= most; decks += 1) {
    const found = raises(how, one, decks, distance, allowed, aTub);
    if (found > raised) {
      best = decks;
      raised = found;
    }
  }
  return best;
}

/**
 * What one more deck is worth, in tonnes an hour, which may be a loss.
 *
 * Below the rope's allowance it is a gain and above it a loss, and the
 * turn comes sooner than the payload alone suggests, because the deck
 * that cannot be filled still has to be lifted. A colliery that has
 * built one is winding steel up and down the shaft all day.
 */
export function worthOfADeck(
  how: Profile,
  one: Decking,
  decks: number,
  distance: number,
  allowed: number,
  aTub = A_TUB,
): number {
  count(decks, "decks");
  within(decks, 1, MOST_DECKS - 1, "decks");
  return round(
    raises(how, one, decks + 1, distance, allowed, aTub) - raises(how, one, decks, distance, allowed, aTub),
    3,
  );
}

/** One deck count, and what a winder does on it. */
export interface DeckRow {
  /** How many decks the cage has. */
  readonly decks: number;
  /** What it carries once the rope has had its say, in kilograms. */
  readonly payload: number;
  /** What the winder stands between winds, in seconds. */
  readonly stand: number;
  /** What the whole cycle takes, in seconds. */
  readonly cycle: number;
  /** What it raises, in tonnes an hour. */
  readonly raises: number;
}

/**
 * The sheet a colliery decides on: one row a deck count.
 *
 * Everything on it is the same arithmetic said five times, which is the
 * point. A single figure for the best number of decks is an answer
 * nobody believes; the row above it and the row below it are what make
 * the answer look like one.
 */
export function deckSheet(
  how: Profile,
  one: Decking,
  distance: number,
  allowed: number,
  most = 4,
  aTub = A_TUB,
): DeckRow[] {
  count(most, "most");
  within(most, 1, MOST_DECKS, "most");
  const out: DeckRow[] = [];
  for (let decks = 1; decks <= most; decks += 1) {
    const loaded = deckedCage(one, decks, allowed, aTub);
    const empty = conveyance({ ...loaded, name: "the empty cage", payload: 0 });
    const working = withDecking(how, one, loaded, empty);
    out.push({
      decks,
      payload: loaded.payload,
      stand: working.rest,
      cycle: cycleTime(working, distance),
      raises: raises(how, one, decks, distance, allowed, aTub),
    });
  }
  return out;
}

/**
 * The share of the cycle the winder spends standing still.
 *
 * The figure a colliery is never shown, because it is nobody's figure:
 * the winding engineman's part of the cycle is the wind and the landing
 * men's part is the stand, and the only person who sees both is the one
 * who has to explain the day's tonnage.
 */
export function standingShare(
  how: Profile,
  one: Decking,
  rising: Conveyance,
  falling: Conveyance,
  distance: number,
): number {
  const working = withDecking(how, one, rising, falling);
  const whole = cycleTime(working, distance);
  insist(whole > 0, "that cycle takes no time at all", "distance");
  return round(working.rest / whole, 4);
}

/**
 * How many hours of a working day go on standing rather than winding.
 *
 * Worth having in hours rather than as a share, because a share of a
 * cycle is an argument and four hours a day is a fact. On a shallow
 * winder it is most of a shift, and it is a shift nobody is paid for
 * and nobody has costed.
 */
export function standingADay(
  how: Profile,
  one: Decking,
  rising: Conveyance,
  falling: Conveyance,
  distance: number,
  hours = 16,
): number {
  within(hours, 0, 24, "hours");
  return round(standingShare(how, one, rising, falling, distance) * hours, 2);
}

/**
 * What a stated number of decks raises in a working day, in tonnes.
 *
 * The hours are the hours the winder is on coal and not the hours the
 * colliery is open, which on a pit that winds its men down the same
 * shaft are two different numbers and are never both on the sheet.
 */
export function raisesADay(
  how: Profile,
  one: Decking,
  decks: number,
  distance: number,
  allowed: number,
  hours = 16,
  aTub = A_TUB,
): number {
  within(hours, 0, 24, "hours");
  return round(raises(how, one, decks, distance, allowed, aTub) * hours, 1);
}

/**
 * The arrangement in a line, for the top of a report.
 *
 * The stand is the figure worth having at the top of a sheet, because
 * it is the one figure on it a colliery can change this week and
 * without buying anything.
 */
export function describeDecking(one: Decking, what: Conveyance, creep: number): string {
  const held = what.kind === "cage" ? `${what.decks} decks of ${one.tubsADeck} tubs` : `one ${what.kind}`;
  return `${what.name}: ${held}, standing ${standAt(one, what, creep)} s a wind`;
}
