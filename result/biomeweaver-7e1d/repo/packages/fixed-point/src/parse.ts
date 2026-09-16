import { FixedPointError, type Fixed } from "./types.js";

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

export function parseFixed(text: string, scale: bigint): Fixed {
  if (scale <= 0n) {
    throw new FixedPointError("BW-FP-001", "scale must be a positive integer");
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new FixedPointError("BW-FP-002", "fixed-point value is empty");
  }
  let index = 0;
  let sign = 1n;
  const first = trimmed[0];
  if (first === "+") {
    index = 1;
  } else if (first === "-") {
    sign = -1n;
    index = 1;
  }
  if (index >= trimmed.length) {
    throw new FixedPointError("BW-FP-002", "fixed-point value is empty");
  }

  let whole = 0n;
  let sawDigit = false;
  while (index < trimmed.length && isDigit(trimmed[index] ?? "")) {
    whole = whole * 10n + BigInt(trimmed[index] ?? "0");
    index += 1;
    sawDigit = true;
  }

  let fraction = 0n;
  let fractionDigits = 0n;
  if (index < trimmed.length && trimmed[index] === ".") {
    index += 1;
    while (index < trimmed.length && isDigit(trimmed[index] ?? "")) {
      fraction = fraction * 10n + BigInt(trimmed[index] ?? "0");
      fractionDigits += 1n;
      index += 1;
      sawDigit = true;
    }
  }

  if (!sawDigit || index !== trimmed.length) {
    throw new FixedPointError("BW-FP-003", `invalid fixed-point literal "${text}"`);
  }

  let scaleDigits = 0n;
  let scaleCursor = scale;
  while (scaleCursor > 1n) {
    if (scaleCursor % 10n !== 0n) {
      throw new FixedPointError("BW-FP-001", "scale must be a power of ten");
    }
    scaleCursor /= 10n;
    scaleDigits += 1n;
  }
  if (scale !== 1n && scaleCursor !== 1n) {
    throw new FixedPointError("BW-FP-001", "scale must be a power of ten");
  }

  if (fractionDigits > scaleDigits) {
    throw new FixedPointError(
      "BW-FP-004",
      `fractional digits exceed scale ${scale.toString()} in "${text}"`,
    );
  }
  while (fractionDigits < scaleDigits) {
    fraction *= 10n;
    fractionDigits += 1n;
  }
  return sign * (whole * scale + fraction);
}

export function formatFixed(value: Fixed, scale: bigint): string {
  if (scale <= 0n) {
    throw new FixedPointError("BW-FP-001", "scale must be a positive integer");
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / scale;
  const fraction = abs % scale;
  let scaleDigits = 0;
  let scaleCursor = scale;
  while (scaleCursor > 1n) {
    scaleCursor /= 10n;
    scaleDigits += 1;
  }
  const fractionText = fraction.toString().padStart(scaleDigits, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionText}`;
}
