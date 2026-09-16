/**
 * Reading a winding installation off a sheet of paper.
 *
 * A winder file is what an engineer would have written on the back of
 * the certificate: a line for the shaft, a line for the rope, a line
 * for whatever drives it, a line for each conveyance, and a line for
 * how it is set to work. Nothing in it is a figure somebody would have
 * to calculate first — every one of them is measured, ordered, or
 * printed on a maker's plate.
 *
 * What the format refuses is a quantity without a unit and a word it
 * does not know. A file with `dimeter` on the rope line is a file whose
 * rope is fifty-two millimetres because that is the default, and the
 * factor of safety that comes out of it is right for a rope that is not
 * on the machine.
 */

import { WindingError, insist } from "../errors.ts";
import { round as roundTo } from "../units/round.ts";
import { parseLength, parseMass, parseShare, parseSpeed, parseTime } from "../units/measure.ts";
import { type Rope, constructionNamed, rope } from "../rope/index.ts";
import { type Shaft, shaft } from "../shaft/index.ts";
import { type Drive, type Winder, winder } from "./model.ts";
import { drum, koepe } from "../drum/index.ts";
import { type Conveyance, conveyance, kindNamed } from "../cage/index.ts";
import { type Profile, profile } from "../cycle/index.ts";

interface Fields {
  readonly words: string[];
  readonly pairs: Record<string, string>;
}

function split(line: string): Fields {
  const words: string[] = [];
  const pairs: Record<string, string> = {};
  for (const each of line.trim().split(/\s+/)) {
    const at = each.indexOf("=");
    if (at > 0) pairs[each.slice(0, at).toLowerCase()] = each.slice(at + 1);
    else words.push(each);
  }
  return { words, pairs };
}

function article(what: string): string {
  return "aeiou".includes((what[0] ?? "").toLowerCase()) ? "an" : "a";
}

function onlyKnown(fields: Fields, known: readonly string[], what: string): void {
  for (const key of Object.keys(fields.pairs)) {
    if (!known.includes(key)) {
      throw new WindingError(`${key} is not part of ${article(what)} ${what} line (known: ${known.join(", ")})`, what);
    }
  }
}

function must(fields: Fields, key: string, what: string): string {
  const found = fields.pairs[key];
  if (found === undefined) throw new WindingError(`${article(what)} ${what} line wants ${key}`, key);
  return found;
}

function orElse(fields: Fields, key: string, fallback: number, read: (text: string, quantity: string) => number): number {
  const found = fields.pairs[key];
  return found === undefined ? fallback : read(found, key);
}

function plain(text: string, quantity: string): number {
  const found = Number(text);
  if (!Number.isFinite(found)) throw new WindingError(`${quantity} is not a number: ${text}`, quantity);
  return found;
}

function named(thrown: unknown, line: number): unknown {
  if (thrown instanceof WindingError) return new WindingError(`line ${line}: ${thrown.message}`, thrown.quantity);
  return thrown;
}

/** The keywords a winder file is made of. */
export const KEYWORDS: readonly string[] = [
  "winder",
  "shaft",
  "rope",
  "drum",
  "koepe",
  "rising",
  "falling",
  "balance",
  "cycle",
  "working",
];

interface Building {
  name: string;
  shaft: Shaft | undefined;
  rope: Rope | undefined;
  ropes: number;
  drive: Drive | undefined;
  rising: Conveyance | undefined;
  falling: Conveyance | undefined;
  balance: number;
  profile: Profile | undefined;
  hours: number;
}

/**
 * Read a winder file.
 *
 * Blank lines and lines beginning with a hash are ignored; everything
 * else has to start with a keyword the reader knows and carry only keys
 * that keyword takes. Errors carry the line number, because a
 * certificate with twenty lines on it and one mistake is otherwise a
 * puzzle.
 */
export function parseWinder(text: string): Winder {
  const building: Building = {
    name: "",
    shaft: undefined,
    rope: undefined,
    ropes: 1,
    drive: undefined,
    rising: undefined,
    falling: undefined,
    balance: 0,
    profile: undefined,
    hours: 16,
  };
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at += 1) {
    const raw = (lines[at] ?? "").split("#")[0] ?? "";
    if (raw.trim().length === 0) continue;
    try {
      read(building, raw);
    } catch (thrown) {
      throw named(thrown, at + 1);
    }
  }
  return assemble(building);
}

function read(building: Building, raw: string): void {
  const fields = split(raw);
  const keyword = (fields.words[0] ?? "").toLowerCase();
  if (!KEYWORDS.includes(keyword)) {
    throw new WindingError(`${keyword} is not a word this reader knows (${KEYWORDS.join(", ")})`, "keyword");
  }
  const rest = fields.words.slice(1);
  if (keyword === "winder") readWinder(building, fields, rest);
  else if (keyword === "shaft") readShaft(building, fields, rest);
  else if (keyword === "rope") readRope(building, fields);
  else if (keyword === "drum") readDrum(building, fields);
  else if (keyword === "koepe") readKoepe(building, fields);
  else if (keyword === "rising" || keyword === "falling") readConveyance(building, fields, rest, keyword);
  else if (keyword === "balance") readBalance(building, fields);
  else if (keyword === "cycle") readCycle(building, fields);
  else readWorking(building, fields);
}

function readWinder(building: Building, fields: Fields, rest: readonly string[]): void {
  onlyKnown(fields, [], "winder");
  insist(building.name === "", "that file names two winders", "winder");
  insist(rest.length > 0, "a winder line wants a name", "name");
  building.name = rest.join(" ");
}

function readShaft(building: Building, fields: Fields, rest: readonly string[]): void {
  onlyKnown(fields, ["diameter", "depth", "conveyances", "sump", "headgear"], "shaft");
  insist(building.shaft === undefined, "that file names two shafts", "shaft");
  insist(rest.length > 0, "a shaft line wants a name", "name");
  building.shaft = shaft(
    rest.join(" "),
    parseLength(must(fields, "diameter", "shaft"), "diameter"),
    parseLength(must(fields, "depth", "shaft"), "depth"),
    orElse(fields, "conveyances", 2, plain),
    orElse(fields, "sump", 15, parseLength),
    orElse(fields, "headgear", 42, parseLength),
  );
}

function readRope(building: Building, fields: Fields): void {
  onlyKnown(fields, ["diameter", "construction", "grade", "ropes"], "rope");
  insist(building.rope === undefined, "that file states the rope twice", "rope");
  const made = fields.pairs["construction"];
  building.rope = rope(
    // A rope is ordered in millimetres and read here in metres, so the
    // conversion has to be rounded or a 52 mm rope becomes 52.000000001
    // and says so on every report it appears on.
    roundTo(parseLength(must(fields, "diameter", "rope"), "diameter") * 1000, 3),
    made === undefined ? constructionNamed("6x36") : constructionNamed(made),
    orElse(fields, "grade", 1960, plain),
  );
  building.ropes = orElse(fields, "ropes", 1, plain);
}

function readDrum(building: Building, fields: Fields): void {
  onlyKnown(fields, ["diameter", "width", "layers", "lead"], "drum");
  insist(building.drive === undefined, "that file gives the winder two drives", "drum");
  building.drive = {
    kind: "drum",
    drum: drum(
      parseLength(must(fields, "diameter", "drum"), "diameter"),
      parseLength(must(fields, "width", "drum"), "width"),
      orElse(fields, "layers", 2, plain),
      orElse(fields, "lead", 46, parseLength),
    ),
  };
}

function readKoepe(building: Building, fields: Fields): void {
  onlyKnown(fields, ["diameter", "wrap", "friction", "ropes"], "koepe");
  insist(building.drive === undefined, "that file gives the winder two drives", "koepe");
  building.drive = {
    kind: "koepe",
    koepe: koepe(
      parseLength(must(fields, "diameter", "koepe"), "diameter"),
      orElse(fields, "wrap", 180, plain),
      orElse(fields, "friction", 0.25, plain),
      orElse(fields, "ropes", 4, plain),
    ),
  };
}

function readConveyance(building: Building, fields: Fields, rest: readonly string[], which: string): void {
  onlyKnown(fields, ["tare", "payload", "decks", "width", "across"], which);
  insist(rest.length > 0, `${article(which)} ${which} line names what sort it is`, "kind");
  const kind = kindNamed(rest[0] as string);
  const found = conveyance({
    name: rest.length > 1 ? rest.slice(1).join(" ") : `the ${which} ${kind}`,
    kind,
    tare: parseMass(must(fields, "tare", which), "tare"),
    payload: orElse(fields, "payload", 0, parseMass),
    decks: orElse(fields, "decks", kind === "cage" ? 2 : 1, plain),
    width: orElse(fields, "width", 2.6, parseLength),
    across: orElse(fields, "across", 1.5, parseLength),
  });
  if (which === "rising") {
    insist(building.rising === undefined, "that file has two rising conveyances", "rising");
    building.rising = found;
  } else {
    insist(building.falling === undefined, "that file has two falling conveyances", "falling");
    building.falling = found;
  }
}

function readBalance(building: Building, fields: Fields): void {
  onlyKnown(fields, ["rate"], "balance");
  const text = must(fields, "rate", "balance");
  // A balance rope is quoted as a weight a metre, so the mass is read
  // and the "a metre" is the line's own meaning.
  building.balance = parseMass(text, "rate");
}

function readCycle(building: Building, fields: Fields): void {
  onlyKnown(fields, ["full", "accelerate", "decelerate", "creep", "creepfor", "rest"], "cycle");
  insist(building.profile === undefined, "that file states the cycle twice", "cycle");
  building.profile = profile({
    full: parseSpeed(must(fields, "full", "cycle"), "full"),
    accelerate: orElse(fields, "accelerate", 1, plain),
    decelerate: orElse(fields, "decelerate", 1.1, plain),
    creep: orElse(fields, "creep", 0.5, parseSpeed),
    creepFor: orElse(fields, "creepfor", 6, parseLength),
    rest: orElse(fields, "rest", 25, parseTime),
  });
}

function readWorking(building: Building, fields: Fields): void {
  onlyKnown(fields, ["hours"], "working");
  building.hours = orElse(fields, "hours", 16, (text, quantity) => parseTime(text, quantity) / 3600);
}

function wanted<T>(found: T | undefined, says: string, quantity: string): T {
  if (found === undefined) throw new WindingError(says, quantity);
  return found;
}

function assemble(building: Building): Winder {
  insist(building.name !== "", "that file never says which winder it is about", "winder");
  return winder({
    name: building.name,
    shaft: wanted(building.shaft, "that file describes no shaft", "shaft"),
    rope: wanted(building.rope, "that file describes no rope", "rope"),
    ropes: building.ropes,
    drive: wanted(building.drive, "that file says nothing about what drives the rope", "drum"),
    rising: wanted(building.rising, "that file has nothing going up", "rising"),
    falling: wanted(building.falling, "that file has nothing coming down", "falling"),
    balance: building.balance,
    profile: wanted(building.profile, "that file says nothing about how it is worked", "cycle"),
    hours: building.hours,
  });
}

/** A share read the way the file writes one, for a caller checking a line. */
export function readShare(text: string, quantity = "share"): number {
  return parseShare(text, quantity);
}
