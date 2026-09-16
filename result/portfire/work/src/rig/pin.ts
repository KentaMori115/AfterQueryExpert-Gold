/**
 * Where a cue is wired.
 *
 * A firing system is a set of modules, each with a fixed number of outputs,
 * and every effect on the field ends up on exactly one of them. The address is
 * written `12.07` on the panel, `12-7` in most exports and `M12/7` on the
 * labels the crew ties to the leads, so all three have to read the same.
 *
 * Pin numbers start at one, not zero. That is not a style choice. The physical
 * terminals are printed 1 to 32 and a crew reading a table against a module in
 * the dark will not tolerate an off by one.
 */

export interface PinAddress {
  /** Module number as printed on the case. */
  readonly module: number;
  /** Output number, one based. */
  readonly pin: number;
}

const PATTERN = /^\s*m?(\d{1,3})\s*[.\-/:]\s*(\d{1,3})\s*$/i;

export function pinAddress(module: number, pin: number): PinAddress {
  if (!Number.isInteger(module) || module < 1) {
    throw new RangeError(
      `module number ${module} is not a whole number above zero`,
    );
  }
  if (!Number.isInteger(pin) || pin < 1) {
    throw new RangeError(`pin number ${pin} is not a whole number above zero`);
  }
  return { module, pin };
}

export function parsePin(text: string): PinAddress | undefined {
  const match = PATTERN.exec(text);
  if (!match) {
    return undefined;
  }
  const module = Number(match[1]);
  const pin = Number(match[2]);
  if (module < 1 || pin < 1) {
    return undefined;
  }
  return { module, pin };
}

/** The panel's own spelling, zero padded so a sorted list lines up. */
export function formatPin(address: PinAddress): string {
  return `${String(address.module).padStart(2, "0")}.${String(address.pin).padStart(2, "0")}`;
}

/** The spelling on a lead label, which a crew reads out loud. */
export function labelPin(address: PinAddress): string {
  return `M${address.module}/${address.pin}`;
}

export function samePin(a: PinAddress, b: PinAddress): boolean {
  return a.module === b.module && a.pin === b.pin;
}

export function comparePins(a: PinAddress, b: PinAddress): number {
  return a.module !== b.module ? a.module - b.module : a.pin - b.pin;
}

export function sortPins(addresses: readonly PinAddress[]): PinAddress[] {
  return [...addresses].sort(comparePins);
}

/** A key that can go in a Set or a Map without a comparator. */
export function pinKey(address: PinAddress): string {
  return `${address.module}:${address.pin}`;
}

/**
 * Every pin from one address to another inclusive, walking across module
 * boundaries. Used by the script's range syntax, where a crew writes
 * `12.01 to 12.32` for a whole module or `12.30 to 13.02` for a rack that
 * spans two.
 */
export function pinRange(
  from: PinAddress,
  to: PinAddress,
  pinsPerModule: number,
): PinAddress[] {
  if (!Number.isInteger(pinsPerModule) || pinsPerModule < 1) {
    throw new RangeError("a module has to have at least one pin");
  }
  if (from.pin > pinsPerModule || to.pin > pinsPerModule) {
    throw new RangeError(
      `a module of ${pinsPerModule} pins cannot reach pin ${Math.max(from.pin, to.pin)}`,
    );
  }
  if (comparePins(from, to) > 0) {
    return pinRange(to, from, pinsPerModule).reverse();
  }
  const out: PinAddress[] = [];
  let module = from.module;
  let pin = from.pin;
  for (;;) {
    out.push({ module, pin });
    if (module === to.module && pin === to.pin) {
      break;
    }
    pin += 1;
    if (pin > pinsPerModule) {
      pin = 1;
      module += 1;
    }
    if (out.length > 100000) {
      throw new RangeError("pin range is implausibly long, check the ends");
    }
  }
  return out;
}

/** Every pin on one module, in order. */
export function allPinsOn(module: number, pinsPerModule: number): PinAddress[] {
  return pinRange(
    pinAddress(module, 1),
    pinAddress(module, pinsPerModule),
    pinsPerModule,
  );
}

/**
 * The flat index of a pin across a rig of equal sized modules, counting from
 * zero. This is what a panel's own firing table uses internally, and it is the
 * only form in which an export from one maker imports into another.
 */
export function pinIndex(address: PinAddress, pinsPerModule: number): number {
  return (address.module - 1) * pinsPerModule + (address.pin - 1);
}

export function pinFromIndex(index: number, pinsPerModule: number): PinAddress {
  if (index < 0 || !Number.isInteger(index)) {
    throw new RangeError(`pin index ${index} is not a whole number`);
  }
  return {
    module: Math.floor(index / pinsPerModule) + 1,
    pin: (index % pinsPerModule) + 1,
  };
}
