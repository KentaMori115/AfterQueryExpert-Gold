import type { FiringModule, ModuleModel } from "./module.js";
import { firstFreePin, holdsPin, pinsOf, usageOf } from "./module.js";
import type { PinAddress } from "./pin.js";
import { comparePins, formatPin, pinKey } from "./pin.js";
import type { PositionId } from "../core/ids.js";
import { compareIds } from "../core/ids.js";

/**
 * The whole firing system, and where it stands on the field.
 *
 * A rig is a set of modules grouped by firing position. The position is the
 * unit that matters operationally, because a position is one rack or one row
 * of mortars, one set of separation distances, and one place a crew member has
 * to walk to. Two modules at the same position are interchangeable for wiring
 * purposes. Two modules at different positions are not, however close the
 * numbers on their cases happen to be.
 */

export interface FiringPosition {
  readonly id: PositionId;
  /** Metres east of the site origin, positive towards the audience's right. */
  readonly east: number;
  /** Metres north of the site origin, positive away from the audience. */
  readonly north: number;
  readonly note?: string;
}

export function firingPosition(
  id: PositionId,
  east: number,
  north: number,
  note?: string,
): FiringPosition {
  if (!Number.isFinite(east) || !Number.isFinite(north)) {
    throw new RangeError(`position ${id} has a coordinate that is not finite`);
  }
  const built: { id: PositionId; east: number; north: number; note?: string } =
    { id, east, north };
  if (note !== undefined) {
    built.note = note;
  }
  return built;
}

export function distanceBetween(a: FiringPosition, b: FiringPosition): number {
  return Math.hypot(a.east - b.east, a.north - b.north);
}

export class Rig {
  private readonly modules = new Map<number, FiringModule>();
  private readonly positions = new Map<string, FiringPosition>();

  static from(
    positions: Iterable<FiringPosition>,
    modules: Iterable<FiringModule>,
  ): Rig {
    const rig = new Rig();
    for (const spot of positions) {
      rig.addPosition(spot);
    }
    for (const unit of modules) {
      rig.addModule(unit);
    }
    return rig;
  }

  addPosition(spot: FiringPosition): this {
    this.positions.set(spot.id, spot);
    return this;
  }

  /** Add a module, replacing any module with the same case number. */
  addModule(unit: FiringModule): this {
    this.modules.set(unit.number, unit);
    return this;
  }

  get moduleCount(): number {
    return this.modules.size;
  }

  get positionCount(): number {
    return this.positions.size;
  }

  /** Every output on every module, which is the rig's hard capacity. */
  get pinCount(): number {
    let total = 0;
    for (const unit of this.modules.values()) {
      total += unit.model.pins;
    }
    return total;
  }

  module(number: number): FiringModule | undefined {
    return this.modules.get(number);
  }

  position(id: string): FiringPosition | undefined {
    return this.positions.get(id);
  }

  moduleNumbers(): number[] {
    return [...this.modules.keys()].sort((a, b) => a - b);
  }

  positionIds(): PositionId[] {
    return [...this.positions.keys()].sort(compareIds) as PositionId[];
  }

  allModules(): FiringModule[] {
    return this.moduleNumbers().map((number) => {
      const unit = this.modules.get(number);
      if (unit === undefined) {
        throw new Error(
          `rig lost module ${number} between listing and reading`,
        );
      }
      return unit;
    });
  }

  modulesAt(id: string): FiringModule[] {
    return this.allModules().filter((unit) => unit.position === id);
  }

  /** Which module owns an address, or nothing when the rig has no such pin. */
  moduleFor(address: PinAddress): FiringModule | undefined {
    const unit = this.modules.get(address.module);
    return unit !== undefined && holdsPin(unit, address) ? unit : undefined;
  }

  hasPin(address: PinAddress): boolean {
    return this.moduleFor(address) !== undefined;
  }

  positionOf(address: PinAddress): PositionId | undefined {
    return this.moduleFor(address)?.position;
  }

  allPins(): PinAddress[] {
    return this.allModules()
      .flatMap((unit) => pinsOf(unit))
      .sort(comparePins);
  }

  pinsAt(id: string): PinAddress[] {
    return this.modulesAt(id)
      .flatMap((unit) => pinsOf(unit))
      .sort(comparePins);
  }

  /** Positions named by a module but never defined, which is a wiring typo. */
  undefinedPositions(): string[] {
    const missing = new Set<string>();
    for (const unit of this.modules.values()) {
      if (!this.positions.has(unit.position)) {
        missing.add(unit.position);
      }
    }
    return [...missing].sort(compareIds);
  }

  /** Positions with no module standing at them, which is usually a leftover. */
  emptyPositions(): PositionId[] {
    return this.positionIds().filter((id) => this.modulesAt(id).length === 0);
  }

  modelsInUse(): ModuleModel[] {
    const seen = new Map<string, ModuleModel>();
    for (const unit of this.modules.values()) {
      seen.set(unit.model.name, unit.model);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The first free pin anywhere, walking modules in case number order. */
  nextFreePin(taken: ReadonlySet<string>): PinAddress | undefined {
    for (const unit of this.allModules()) {
      const free = firstFreePin(unit, taken);
      if (free !== undefined) {
        return free;
      }
    }
    return undefined;
  }

  /** The first free pin at one position, for a cue pinned to a rack. */
  nextFreePinAt(
    id: string,
    taken: ReadonlySet<string>,
  ): PinAddress | undefined {
    for (const unit of this.modulesAt(id)) {
      const free = firstFreePin(unit, taken);
      if (free !== undefined) {
        return free;
      }
    }
    return undefined;
  }

  freeCount(taken: Iterable<PinAddress>): number {
    const used = new Set([...taken].map(pinKey));
    return this.allPins().filter((address) => !used.has(pinKey(address)))
      .length;
  }

  describe(): string {
    const lines: string[] = [];
    for (const id of this.positionIds()) {
      const units = this.modulesAt(id);
      const pins = units.reduce((total, unit) => total + unit.model.pins, 0);
      lines.push(`${id}: ${units.length} modules, ${pins} pins`);
    }
    return lines.join("\n");
  }

  usageSummary(taken: Iterable<PinAddress>): string[] {
    const addresses = [...taken];
    return this.allModules().map((unit) => {
      const usage = usageOf(unit, addresses);
      const first = formatPin({ module: unit.number, pin: 1 });
      return `${first.slice(0, 2)} ${usage.used}/${unit.model.pins}`;
    });
  }
}
