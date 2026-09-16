import type { Milliseconds } from "../core/units.js";
import { ms, raw } from "../core/units.js";
import type { PinAddress } from "../rig/pin.js";
import { pinKey } from "../rig/pin.js";
import type { Shot } from "../script/expand.js";

/**
 * A run fired from one output.
 *
 * A chained run is one electric match on the head tube and a length of
 * quickmatch running down the rack, so the panel closes one circuit and the
 * fire does the rest. Every shot of the run is still a shell in a mortar and
 * still goes up, so the compiler keeps one event per shot, all on the head's
 * address, and marks each with the fuse: how long after the head's ignition
 * the fire reaches that tube. The head carries a fuse of zero.
 *
 * The rule everything downstream follows is that a chained run is one cue
 * and many shots. Anything that counts cues, rows, outputs, pins, leads or
 * pulses looks at the head alone. Anything that counts shots, shells, tubes,
 * stock, hazard or what is lit looks at every shot. Getting one of those the
 * wrong way round produces a table that is short a shell or a load check that
 * refuses a rig with room to spare, and neither announces itself.
 */

/** Anything that may sit on a chain: a shot, an assignment's shot, an event. */
export interface Fused {
  readonly fuse?: Milliseconds;
}

/** Whether the thing belongs to a chained run at all, head included. */
export function isFused(item: Fused): boolean {
  return item.fuse !== undefined;
}

/**
 * Whether the thing is a cue the panel fires: anything unchained, and the
 * head of a chain. Followers are lit by the fuse, not by the panel.
 */
export function isHead(item: Fused): boolean {
  return item.fuse === undefined || raw(item.fuse) === 0;
}

/** A shot lit by quickmatch rather than by the panel. */
export function isFollower(item: Fused): boolean {
  return item.fuse !== undefined && raw(item.fuse) > 0;
}

/** The events a panel actually fires, in the order they were given. */
export function panelEvents<T extends Fused>(items: readonly T[]): T[] {
  return items.filter(isHead);
}

/**
 * The identity of the chain a shot belongs to, before any pin exists. A
 * statement inside a group played twice expands into two runs, so the
 * statement alone is not enough: the head's cue time tells the two apart,
 * and every shot of a run knows it from its own time less its fuse.
 */
export function chainKeyOf(shot: Shot): string {
  const head = raw(shot.at) - raw(shot.fuse ?? ms(0));
  return `${shot.origin.start}:${shot.origin.end}@${head}`;
}

/** Something with a pin, which after allocation is what names a chain. */
export interface Addressed extends Fused {
  readonly address: PinAddress;
}

/**
 * Every chained run, keyed by the pin it fires from, each in fuse order. A
 * chain owns its pin outright, so the pin is the only key needed once the
 * allocation has happened. Runs of one, a chained ripple written with a
 * count of one, are included: they are chains with nothing to follow.
 */
export function chainsOf<T extends Addressed>(
  items: readonly T[],
): Map<string, T[]> {
  const chains = new Map<string, T[]>();
  for (const item of items) {
    if (!isFused(item)) {
      continue;
    }
    const key = pinKey(item.address);
    const held = chains.get(key) ?? [];
    held.push(item);
    chains.set(key, held);
  }
  for (const run of chains.values()) {
    run.sort((a, b) => raw(a.fuse ?? ms(0)) - raw(b.fuse ?? ms(0)));
  }
  return chains;
}

/** The whole run one item belongs to, itself included, in fuse order. */
export function chainOf<T extends Addressed>(
  item: T,
  items: readonly T[],
): T[] {
  if (!isFused(item)) {
    return [item];
  }
  return chainsOf(items).get(pinKey(item.address)) ?? [item];
}

/** The head of the run an item belongs to, or the item when it is unchained. */
export function headOf<T extends Addressed>(item: T, items: readonly T[]): T {
  const run = chainOf(item, items);
  return run[0] ?? item;
}

/**
 * The interval the fuse was cut for, read off the first follower. A run of
 * one has no interval, and neither does an unchained item.
 */
export function chainInterval(run: readonly Fused[]): Milliseconds {
  const second = run[1];
  return second?.fuse === undefined ? ms(0) : second.fuse;
}

/** One line for a sheet or a pin list, saying what the output actually lights. */
export function describeRun(run: readonly Fused[]): string {
  if (run.length <= 1) {
    return run.length === 1 && isFused(run[0] ?? {}) ? "chained, one shot" : "";
  }
  return `chain of ${run.length}, ${raw(chainInterval(run))}ms apart`;
}

/** Which shot of its run an item is, counting from one. */
export function positionInRun(
  item: Addressed,
  run: readonly Addressed[],
): number {
  const index = run.indexOf(item);
  return index === -1 ? 1 : index + 1;
}
