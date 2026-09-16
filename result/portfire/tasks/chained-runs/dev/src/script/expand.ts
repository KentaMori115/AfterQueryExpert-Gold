import type {
  CueStatement,
  FanStatement,
  PinChoice,
  RippleStatement,
  Statement,
} from "./ast.js";
import { findGroup } from "./ast.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { Rng } from "../core/rng.js";
import type { Span } from "../core/span.js";
import type { Metres, Milliseconds } from "../core/units.js";
import { ms, raw } from "../core/units.js";
import { MAX_CHAIN_LENGTH } from "../timeline/chain.js";

/**
 * Turning the shorthand into individual shots.
 *
 * A ripple, a fan and a chase are all shorthand for a run of shots, and the
 * only difference between them is how the times and the positions are laid
 * out. Expanding them here rather than in the scheduler means everything
 * downstream sees one flat list, and a shooter can ask what a macro actually
 * produced before committing to it.
 *
 * Jitter comes from a stream forked by the macro's own label, so editing one
 * fan does not reshuffle every other fan in the show. That property is worth
 * more than it sounds. Without it, adding a cue in bar three changes the
 * firing table for the whole finale, and the diff a shooter reads the morning
 * of the show becomes unreadable.
 */

export interface Shot {
  /** When the effect should be seen, before any lift compensation. */
  readonly at: Milliseconds;
  readonly effect: string;
  readonly position: string;
  readonly pin: PinChoice;
  readonly height?: Metres;
  /** The label of the statement this shot came from, if it had one. */
  readonly label?: string;
  /** Which shot of the macro this is, counting from zero. */
  readonly index: number;
  /** Where in the script the shot came from. */
  readonly origin: Span;
  /**
   * Set on every shot of a chained run: how long after the head's ignition
   * the quickmatch reaches this tube. Zero on the head, which is the one
   * shot of the run the panel fires.
   */
  readonly fuse?: Milliseconds;
}

export interface ExpandOptions {
  readonly seed?: string;
  /** Cap on how many shots one statement may produce. */
  readonly maxPerStatement?: number;
}

const DEFAULT_MAX_PER_STATEMENT = 500;

function shot(
  base: {
    at: Milliseconds;
    effect: string;
    position: string;
    pin: PinChoice;
    origin: Span;
    index: number;
  },
  height?: Metres,
  label?: string,
  fuse?: Milliseconds,
): Shot {
  return {
    ...base,
    ...(height === undefined ? {} : { height }),
    ...(label === undefined ? {} : { label }),
    ...(fuse === undefined ? {} : { fuse }),
  };
}

/**
 * A run of shots at one position, evenly spaced, is what a chain can fire.
 * The times are the run's own; what changes is that every shot after the
 * first is lit by the fuse rather than by the panel, so each carries how far
 * down the quickmatch it sits. The head takes the pin the script named, if
 * it named one, and the rest take none, because they have no circuit.
 */
function chainRun(
  statement: RippleStatement | FanStatement,
  times: readonly number[],
): Shot[] {
  const head = times[0] ?? 0;
  return times.map((at, i) =>
    shot(
      {
        at: ms(at),
        effect: statement.effect,
        position: statement.position,
        pin: i === 0 ? (statement.pin ?? { kind: "auto" }) : { kind: "auto" },
        origin: statement.span,
        index: i,
      },
      undefined,
      statement.label,
      ms(at - head),
    ),
  );
}

/**
 * Whether a chained run can be built at all. The far end of a long chain
 * often does not light, so past the limit the run is refused rather than
 * fired on hope, and a run with no interval has nowhere to cut the fuse.
 */
function chainProblem(
  statement: RippleStatement | FanStatement,
  interval: number,
  diagnostics: DiagnosticBag,
): boolean {
  if (statement.count > MAX_CHAIN_LENGTH) {
    diagnostics.error({
      code: "PF2203",
      message: `a chain of ${statement.count} is longer than ${MAX_CHAIN_LENGTH}, and the far end of a long chain often does not light`,
      span: statement.span,
      help: "split the run into two chains, or fire it from its own pins",
    });
    return true;
  }
  if (statement.count > 1 && interval <= 0) {
    diagnostics.error({
      code: "PF2204",
      message: `a chained ${statement.kind} needs an interval above zero to cut the fuse for`,
      span: statement.span,
      help: "give the run an interval, or fire it from its own pins",
    });
    return true;
  }
  return false;
}

/**
 * The name a macro's jitter stream is forked from. A statement with a label
 * keeps its own stream across every edit elsewhere in the script. One without
 * a label falls back to its cue time, which is stable enough for the common
 * case and is the reason to write a label on anything being tuned.
 */
function labelFor(statement: CueStatement, fallback: string): string {
  const label = "label" in statement ? statement.label : undefined;
  return label ?? `${fallback}@${raw(statement.at)}`;
}

export function expandStatement(
  statement: CueStatement,
  offset: Milliseconds,
  rng: Rng,
  diagnostics: DiagnosticBag,
  options: ExpandOptions = {},
): Shot[] {
  const cap = options.maxPerStatement ?? DEFAULT_MAX_PER_STATEMENT;
  const start = raw(statement.at) + raw(offset);

  switch (statement.kind) {
    case "fire":
      return [
        shot(
          {
            at: ms(start),
            effect: statement.effect,
            position: statement.position,
            pin: statement.pin,
            origin: statement.span,
            index: 0,
          },
          statement.height,
          statement.label,
        ),
      ];

    case "ripple": {
      if (statement.count > cap) {
        tooMany(diagnostics, statement, statement.count, cap);
        return [];
      }
      if (statement.chained === true) {
        const every = raw(statement.every);
        if (chainProblem(statement, every, diagnostics)) {
          return [];
        }
        return chainRun(
          statement,
          Array.from({ length: statement.count }, (_, i) =>
            Math.round(start + i * every),
          ),
        );
      }
      const stream = rng.fork(labelFor(statement, "ripple"));
      const jitter = statement.jitter === undefined ? 0 : raw(statement.jitter);
      const shots: Shot[] = [];
      for (let i = 0; i < statement.count; i += 1) {
        const wobble = jitter === 0 ? 0 : stream.nextJitter(jitter);
        shots.push(
          shot(
            {
              at: ms(Math.round(start + i * raw(statement.every) + wobble)),
              effect: statement.effect,
              position: statement.position,
              pin: { kind: "auto" },
              origin: statement.span,
              index: i,
            },
            undefined,
            statement.label,
          ),
        );
      }
      return shots;
    }

    case "fan": {
      if (statement.count > cap) {
        tooMany(diagnostics, statement, statement.count, cap);
        return [];
      }
      const stream = rng.fork(labelFor(statement, "fan"));
      const jitter = statement.jitter === undefined ? 0 : raw(statement.jitter);
      const spread = raw(statement.spread);
      const shots: Shot[] = [];
      // A fan is centred on its cue time, so the middle of the run lands on
      // the beat rather than its first shot. That is what makes a fan read as
      // one gesture and a ripple read as a run.
      // With one shot there is nothing to spread, so the fan collapses onto
      // its own cue time rather than half a spread early.
      const step = statement.count > 1 ? spread / (statement.count - 1) : 0;
      const half = statement.count > 1 ? spread / 2 : 0;
      if (statement.chained === true) {
        if (chainProblem(statement, spread, diagnostics)) {
          return [];
        }
        return chainRun(
          statement,
          Array.from({ length: statement.count }, (_, i) =>
            Math.round(start - half + i * step),
          ),
        );
      }
      for (let i = 0; i < statement.count; i += 1) {
        const wobble = jitter === 0 ? 0 : stream.nextJitter(jitter);
        shots.push(
          shot(
            {
              at: ms(Math.round(start - half + i * step + wobble)),
              effect: statement.effect,
              position: statement.position,
              pin: { kind: "auto" },
              origin: statement.span,
              index: i,
            },
            undefined,
            statement.label,
          ),
        );
      }
      return shots;
    }

    case "chase": {
      const total = statement.positions.length * statement.passes;
      if (total > cap) {
        tooMany(diagnostics, statement, total, cap);
        return [];
      }
      const shots: Shot[] = [];
      for (let i = 0; i < total; i += 1) {
        const position = statement.positions[i % statement.positions.length];
        if (position === undefined) {
          continue;
        }
        shots.push(
          shot(
            {
              at: ms(Math.round(start + i * raw(statement.every))),
              effect: statement.effect,
              position,
              pin: { kind: "auto" },
              origin: statement.span,
              index: i,
            },
            undefined,
            statement.label,
          ),
        );
      }
      return shots;
    }

    case "play":
      // A play is expanded by the caller, which is the only place that knows
      // what groups exist.
      return [];
  }
}

function tooMany(
  diagnostics: DiagnosticBag,
  statement: CueStatement,
  wanted: number,
  cap: number,
): void {
  diagnostics.error({
    code: "PF2200",
    message: `this ${statement.kind} would produce ${wanted} shots, over the cap of ${cap}`,
    span: statement.span,
    help: "split it into several statements, or raise the cap deliberately",
  });
}

export interface Expansion {
  readonly shots: readonly Shot[];
  readonly diagnostics: DiagnosticBag;
}

export function expandScript(
  statements: readonly Statement[],
  options: ExpandOptions = {},
): Expansion {
  const diagnostics = new DiagnosticBag();
  const rng = new Rng(options.seed ?? "portfire");
  const shots: Shot[] = [];
  const playing: string[] = [];

  const runCue = (statement: CueStatement, offset: Milliseconds): void => {
    if (statement.kind === "play") {
      const group = findGroup(statements, statement.group);
      if (group === undefined) {
        diagnostics.error({
          code: "PF2201",
          message: `there is no group called ${statement.group}`,
          span: statement.span,
        });
        return;
      }
      if (playing.includes(group.name)) {
        diagnostics.error({
          code: "PF2202",
          message: `group ${group.name} plays itself, ${[...playing, group.name].join(" -> ")}`,
          span: statement.span,
        });
        return;
      }
      playing.push(group.name);
      const inner = ms(raw(statement.at) + raw(offset));
      for (const child of group.body) {
        runCue(child, inner);
      }
      playing.pop();
      return;
    }
    shots.push(
      ...expandStatement(statement, offset, rng, diagnostics, options),
    );
  };

  for (const statement of statements) {
    if (statement.kind === "group") {
      continue;
    }
    if (
      statement.kind === "show" ||
      statement.kind === "seed" ||
      statement.kind === "frame" ||
      statement.kind === "include"
    ) {
      continue;
    }
    runCue(statement, ms(0));
  }

  shots.sort((a, b) => raw(a.at) - raw(b.at));
  return { shots, diagnostics };
}
