import { FixedPointError, type Fixed, type RoundingMode } from "./types.js";

export function add(left: Fixed, right: Fixed): Fixed {
  return left + right;
}

export function sub(left: Fixed, right: Fixed): Fixed {
  return left - right;
}

export function neg(value: Fixed): Fixed {
  return -value;
}

export function compare(left: Fixed, right: Fixed): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function min(left: Fixed, right: Fixed): Fixed {
  return left <= right ? left : right;
}

export function max(left: Fixed, right: Fixed): Fixed {
  return left >= right ? left : right;
}

export function clampNonNegative(value: Fixed): Fixed {
  return value < 0n ? 0n : value;
}

export function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new FixedPointError("BW-FP-005", "division by zero");
  }
  const sign = numerator < 0n !== denominator < 0n ? -1n : 1n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  if (remainder === 0n) {
    return sign * quotient;
  }
  const doubled = remainder * 2n;
  if (doubled < absDen) {
    return sign * quotient;
  }
  if (doubled > absDen) {
    return sign * (quotient + 1n);
  }
  return sign * (quotient % 2n === 0n ? quotient : quotient + 1n);
}

export function mul(left: Fixed, right: Fixed, scale: bigint, rounding: RoundingMode): Fixed {
  if (rounding !== "half-even") {
    throw new FixedPointError("BW-FP-006", `unsupported rounding ${rounding}`);
  }
  return roundHalfEven(left * right, scale);
}

export function div(left: Fixed, right: Fixed, scale: bigint, rounding: RoundingMode): Fixed {
  if (rounding !== "half-even") {
    throw new FixedPointError("BW-FP-006", `unsupported rounding ${rounding}`);
  }
  return roundHalfEven(left * scale, right);
}
