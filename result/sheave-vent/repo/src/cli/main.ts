/**
 * The command line.
 *
 * Every command is a function from the parsed arguments to lines of
 * text. Nothing below this file prints or reads the clock, and only the
 * three commands that read a winder file open a file at all — which is
 * what makes the library testable: a command is checked by calling it
 * and looking at what came back, and only this file knows that a
 * terminal is on the other end of it.
 */

import { WindingError } from "../errors.ts";
import { SAYS, VERSION } from "../version.ts";
import type { Args } from "./args.ts";
import { parseArgs } from "./args.ts";
import { heading, wrapped } from "../report/format.ts";
import { left, table } from "../report/table.ts";
import { auditCommand } from "./commands/audit.ts";
import { capelCommand } from "./commands/capel.ts";
import { checksCommand } from "./commands/checks.ts";
import { conveyanceCommand } from "./commands/conveyance.ts";
import { costCommand } from "./commands/cost.ts";
import { cycleCommand } from "./commands/cycle.ts";
import { drumCommand } from "./commands/drum.ts";
import { guidesCommand } from "./commands/guides.ts";
import { koepeCommand } from "./commands/koepe.ts";
import { powerCommand } from "./commands/power.ts";
import { ropeCommand } from "./commands/rope.ts";
import { safetyCommand } from "./commands/safety.ts";
import { shaftCommand } from "./commands/shaft.ts";
import { sizeCommand } from "./commands/size.ts";
import { ventilationCommand } from "./commands/ventilation.ts";
import { wearCommand } from "./commands/wear.ts";
import { winderCommand } from "./commands/winder.ts";
import { worksCommand } from "./commands/works.ts";

/** One command: what it is called, what it does, and how to run it. */
export interface Command {
  /** The word that runs it. */
  readonly name: string;
  /** One line saying what it does. */
  readonly says: string;
  /** What it does. */
  readonly run: (args: Args) => string[];
}

const COMMANDS: readonly Command[] = [
  { name: "rope", says: "what a rope stands, what it weighs, and the depth where the second beats the first", run: ropeCommand },
  { name: "wear", says: "when a rope comes off, and the rule whose factor falls with depth", run: wearCommand },
  { name: "capel", says: "the termination, and the calendar it puts on a sound rope", run: capelCommand },
  { name: "shaft", says: "what will and will not go down the hole", run: shaftCommand },
  { name: "guides", says: "what keeps a conveyance from swinging, and the span the formula wants", run: guidesCommand },
  { name: "drum", says: "the fleet angle, and the second layer that is worse in every way", run: drumCommand },
  { name: "koepe", says: "the friction winder, and the ratio it has to live inside", run: koepeCommand },
  { name: "conveyance", says: "the cage against the skip, which is an argument about tare", run: conveyanceCommand },
  { name: "cycle", says: "the wind, and the standing time that beats it", run: cycleCommand },
  { name: "power", says: "what the engine does, and the r.m.s. that is not the peak", run: powerCommand },
  { name: "ventilation", says: "what the air costs, once the winding has had its share of the shaft", run: ventilationCommand },
  { name: "safety", says: "the gear that does not trust the engineman", run: safetyCommand },
  { name: "winder", says: "a whole installation, read from a file", run: winderCommand },
  { name: "size", says: "an installation for a duty, in one direction", run: sizeCommand },
  { name: "checks", says: "the figures an installation is signed off against", run: checksCommand },
  { name: "audit", says: "what a winding engineer would say after a week here", run: auditCommand },
  { name: "cost", says: "what winding costs, and the day down that costs more", run: costCommand },
  { name: "works", says: "the chain the winder is only one link of", run: worksCommand },
];

/** Every command, in the order they are listed. */
export function commands(): readonly Command[] {
  return COMMANDS;
}

/** A command by name. */
export function commandNamed(name: string): Command {
  const found = COMMANDS.find((each) => each.name === name);
  if (found === undefined) throw new WindingError(`there is no command called ${name}`, "command");
  return found;
}

function distance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) rows.push(new Array<number>(b.length + 1).fill(i));
  const first = rows[0] as number[];
  for (let j = 0; j <= b.length; j += 1) first[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      (rows[i] as number[])[j] = Math.min(
        ((rows[i - 1] as number[])[j] as number) + 1,
        ((rows[i] as number[])[j - 1] as number) + 1,
        ((rows[i - 1] as number[])[j - 1] as number) + cost,
      );
    }
  }
  return (rows[a.length] as number[])[b.length] as number;
}

/**
 * The command whose name is closest to what was typed.
 *
 * Only if it is close. A mistyped command should be guessed at; a word
 * that is not a command at all should not be answered with whichever
 * command happens to share the most letters with it.
 */
export function nearest(name: string): string | undefined {
  let best: string | undefined;
  let least = Number.POSITIVE_INFINITY;
  for (const each of COMMANDS) {
    const apart = distance(name, each.name);
    if (apart < least) {
      least = apart;
      best = each.name;
    }
  }
  return least <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

/** What the program says when it is asked what it does. */
export function usage(): string[] {
  return [
    ...heading(`sheave ${VERSION}`),
    ...wrapped(SAYS),
    "",
    "usage: sheave <command> [options]",
    "",
    ...table([left("command"), left("")], COMMANDS.map((each) => [each.name, each.says])),
    "",
    ...wrapped(
      "Quantities carry their units: --diameter 52mm, --depth 942m, --full 15mps, --payload 12t, " +
        "--hanging 100tonf. A length may be written in fathoms, a speed in feet a minute and a " +
        "power in horsepower, because the trade still speaks in all three. The five commands that " +
        "take a winder file take its path as a bare word: sheave winder examples/bolsover.winder.",
    ),
  ];
}

/**
 * Run a command line and give back what should be printed.
 *
 * The exit code comes back with the lines rather than being thrown,
 * because a command that fails still has something to say and the
 * caller is the one that decides where it goes.
 */
export function run(argv: readonly string[]): { lines: string[]; code: number } {
  const first = argv[0];
  if (first === undefined || first === "--help" || first === "help" || first === "-h") {
    return { lines: usage(), code: 0 };
  }
  if (first === "--version" || first === "version") return { lines: [VERSION], code: 0 };

  const rest = parseArgs(argv.slice(1));
  const found = COMMANDS.find((each) => each.name === first);
  if (found === undefined) {
    const close = nearest(first);
    const lines = [`there is no command called ${first}`];
    if (close !== undefined) lines.push(`did you mean ${close}?`);
    lines.push("", ...usage());
    return { lines, code: 2 };
  }

  try {
    return { lines: found.run(rest), code: 0 };
  } catch (thrown) {
    if (thrown instanceof WindingError) {
      const said = thrown.quantity === undefined ? thrown.message : `${thrown.message} (${thrown.quantity})`;
      return { lines: [said], code: 1 };
    }
    if (thrown instanceof Error) return { lines: [thrown.message], code: 1 };
    throw thrown;
  }
}

/** Run the command line and print what it says. */
export function main(argv: readonly string[]): number {
  const done = run(argv);
  for (const each of done.lines) console.log(each);
  return done.code;
}

const started = process.argv[1];
if (started !== undefined && import.meta.url.endsWith(started.slice(started.lastIndexOf("/") + 1))) {
  process.exitCode = main(process.argv.slice(2));
}
