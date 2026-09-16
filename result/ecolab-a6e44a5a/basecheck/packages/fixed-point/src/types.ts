export const DEFAULT_SCALE = 1_000_000n;

export type RoundingMode = "half-even";

export type Precision = {
  readonly scale: bigint;
  readonly rounding: RoundingMode;
};

export type Fixed = bigint;

export class FixedPointError extends Error {
  public override readonly name = "FixedPointError";

  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
