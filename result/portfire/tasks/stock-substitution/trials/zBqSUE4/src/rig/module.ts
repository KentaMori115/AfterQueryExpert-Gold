import type { PinAddress } from "./pin.js";
import { allPinsOn, formatPin, pinAddress, pinKey } from "./pin.js";
import type { PositionId } from "../core/ids.js";
import type { Amperes } from "../core/units.js";
import { amperes, raw } from "../core/units.js";

/**
 * The boxes on the field.
 *
 * A firing module is a case with a battery, a radio or a wire back to the
 * panel, and a row of screw terminals. Everything that matters about it for
 * the compiler is how many terminals it has, how many of them it can fire at
 * once, and how much current it can push while doing so.
 *
 * The simultaneous limit is the one that surprises people. A module with
 * thirty two outputs very often cannot fire thirty two at once, because the
 * firing capacitor is sized for a handful. Ask for more and the ones at the
 * end of the queue either fire late or do not fire at all, and neither failure
 * announces itself.
 */

export interface ModuleModel {
  readonly name: string;
  readonly pins: number;
  /** How many outputs can be fired on one tick. */
  readonly simultaneous: number;
  /** Total current the module can supply during a firing pulse. */
  readonly firingCurrent: Amperes;
  /** How long the module holds the output closed. */
  readonly pulseMs: number;
}

export const MODELS: readonly ModuleModel[] = [
  {
    name: "fc-32",
    pins: 32,
    simultaneous: 8,
    firingCurrent: amperes(9.6),
    pulseMs: 40,
  },
  {
    name: "fc-16",
    pins: 16,
    simultaneous: 4,
    firingCurrent: amperes(4.8),
    pulseMs: 40,
  },
  {
    name: "slat-50",
    pins: 50,
    simultaneous: 50,
    firingCurrent: amperes(30),
    pulseMs: 25,
  },
  {
    name: "wire-12",
    pins: 12,
    simultaneous: 12,
    firingCurrent: amperes(14.4),
    pulseMs: 60,
  },
];

export function modelNamed(name: string): ModuleModel | undefined {
  return MODELS.find((model) => model.name === name.toLowerCase());
}

export interface FiringModule {
  /** The number printed on the case, unique across the rig. */
  readonly number: number;
  readonly model: ModuleModel;
  /** Which firing position the module stands at. */
  readonly position: PositionId;
  readonly note?: string;
}

export function firingModule(
  number: number,
  model: ModuleModel,
  position: PositionId,
  note?: string,
): FiringModule {
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError(
      `module number ${number} is not a whole number above zero`,
    );
  }
  const built: {
    number: number;
    model: ModuleModel;
    position: PositionId;
    note?: string;
  } = { number, model, position };
  if (note !== undefined) {
    built.note = note;
  }
  return built;
}

export function pinsOf(unit: FiringModule): PinAddress[] {
  return allPinsOn(unit.number, unit.model.pins);
}

export function holdsPin(unit: FiringModule, address: PinAddress): boolean {
  return (
    address.module === unit.number &&
    address.pin >= 1 &&
    address.pin <= unit.model.pins
  );
}

/** Current one output draws, worst case, for the load model. */
export function perPinCurrent(model: ModuleModel): Amperes {
  return amperes(raw(model.firingCurrent) / model.simultaneous);
}

export interface ModuleUsage {
  readonly unit: FiringModule;
  readonly used: number;
  readonly free: number;
  readonly usedPins: readonly PinAddress[];
}

export function usageOf(
  unit: FiringModule,
  taken: Iterable<PinAddress>,
): ModuleUsage {
  const mine = [...taken].filter((address) => holdsPin(unit, address));
  const unique = new Map(mine.map((address) => [pinKey(address), address]));
  const used = unique.size;
  return {
    unit,
    used,
    free: unit.model.pins - used,
    usedPins: [...unique.values()],
  };
}

/** The lowest numbered free pin, which is where an allocator starts. */
export function firstFreePin(
  unit: FiringModule,
  taken: ReadonlySet<string>,
): PinAddress | undefined {
  for (let pin = 1; pin <= unit.model.pins; pin += 1) {
    const address = pinAddress(unit.number, pin);
    if (!taken.has(pinKey(address))) {
      return address;
    }
  }
  return undefined;
}

export function describeModule(unit: FiringModule): string {
  const first = formatPin(pinAddress(unit.number, 1));
  const last = formatPin(pinAddress(unit.number, unit.model.pins));
  return `module ${unit.number} (${unit.model.name}) at ${unit.position}, ${first} to ${last}`;
}
