/**
 * What every diagnostic code means.
 *
 * A code appears in a report, gets read out over a phone, and ends up in a
 * message six months later asking what PF3100 was. Having the explanation in
 * the tool rather than in a wiki means the explanation is the one that shipped
 * with the build that printed the code.
 *
 * The ranges are deliberate and worth keeping. Anything in one thousand is a
 * file that would not load, two thousand is a script that would not compile,
 * three thousand is the timeline, four thousand is safety. So a code alone
 * says which stage found the problem before anybody looks it up.
 */

export interface CodeRange {
  readonly from: number;
  readonly to: number;
  readonly area: string;
  readonly meaning: string;
}

export const CODE_RANGES: readonly CodeRange[] = [
  {
    from: 1000,
    to: 1999,
    area: "loading",
    meaning: "a catalog, magazine, rig sheet or walk that would not load",
  },
  {
    from: 2000,
    to: 2999,
    area: "script",
    meaning: "a cue script that would not lex, parse, expand or resolve",
  },
  {
    from: 3000,
    to: 3999,
    area: "timeline",
    meaning: "quantisation, module load, density, sync, misfires and chains",
  },
  {
    from: 4000,
    to: 4999,
    area: "safety",
    meaning: "wind, separation, airspace, fallout, noise and the crowd",
  },
  {
    from: 5000,
    to: 5999,
    area: "workspace",
    meaning: "a file the command line was told to read and could not",
  },
];

export const CODE_PATTERN = /^PF(\d{4})$/;

export function isCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

export function numberOfCode(code: string): number | undefined {
  const match = CODE_PATTERN.exec(code);
  return match === null ? undefined : Number(match[1]);
}

export function rangeOf(code: string): CodeRange | undefined {
  const number = numberOfCode(code);
  if (number === undefined) {
    return undefined;
  }
  return CODE_RANGES.find(
    (range) => number >= range.from && number <= range.to,
  );
}

export function codeArea(code: string): string {
  return rangeOf(code)?.area ?? "unknown";
}

/**
 * Codes worth naming individually, because they come up in conversation and
 * because the message alone does not say what to do about them. This is not
 * every code, and it does not try to be. A code with an obvious message and a
 * help line does not need a second explanation here.
 */
export const CODE_NOTES: ReadonlyMap<string, string> = new Map([
  [
    "PF1500",
    "the lead is too long for the match to fire over at this voltage, which is the failure that only shows up on the far rack",
  ],
  [
    "PF1600",
    "the magazine is short and nothing in it will stand in, so the cue is still written for a shell the crew does not hold and the show cannot be fired as it stands",
  ],
  [
    "PF1602",
    "a stand in of a different calibre in the same handling band, which changes the separation distance and the time of flight, so both have to be looked at again",
  ],
  [
    "PF1412",
    "a lead is wired to a pin nothing fires, which nearly always means a real cue is on the wrong terminal and will not go",
  ],
  [
    "PF2200",
    "a macro would produce more shots than the cap allows, usually because an interval was typed in the wrong unit",
  ],
  [
    "PF3001",
    "two cues land on one frame, so a run that was written as several reports will be heard as one",
  ],
  [
    "PF3100",
    "a module is asked to close more outputs at once than its firing capacitor can supply, so the later ones fire late or not at all",
  ],
  [
    "PF3201",
    "nothing is lit for long enough that an audience reads it as a misfire",
  ],
  [
    "PF4100",
    "a firing position is closer to the audience than the separation rule allows for what it fires",
  ],
  [
    "PF4102",
    "fallout is predicted to cross a hard boundary, which is a stop rather than a warning",
  ],
  [
    "PF4300",
    "more people are expected than the viewing area holds at the density given",
  ],
]);

export interface CodeExplanation {
  readonly code: string;
  readonly area: string;
  readonly meaning: string;
  readonly note?: string;
}

export function explainCode(code: string): CodeExplanation | undefined {
  const upper = code.toUpperCase();
  const range = rangeOf(upper);
  if (range === undefined) {
    return undefined;
  }
  const note = CODE_NOTES.get(upper);
  return {
    code: upper,
    area: range.area,
    meaning: range.meaning,
    ...(note === undefined ? {} : { note }),
  };
}

/** Every code with a note, for a listing. */
export function notedCodes(): string[] {
  return [...CODE_NOTES.keys()].sort();
}
