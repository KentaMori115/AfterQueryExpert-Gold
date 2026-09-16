import type { MatchSpec } from "./circuit.js";
import { matchNamed } from "./circuit.js";
import { firingModule, modelNamed } from "./module.js";
import { Rig, firingPosition } from "./rig.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { checkId, positionId } from "../core/ids.js";
import { SourceFile, span } from "../core/span.js";

/**
 * Reading the rig sheet.
 *
 * The rig is written by hand, in a text file, usually while walking the site
 * with a tape measure. So the format is one statement per line with no
 * punctuation to forget, and the parser is line based rather than a real
 * grammar. Everything after a hash is a comment, because that is what every
 * crew already assumes.
 *
 *   position pad.a at 0 0
 *   position pad.b at 40 0 behind the water
 *   module 1 fc-32 at pad.a
 *   match standard
 *   voltage 24
 *   lead 30
 */

export interface RigSettings {
  readonly match: MatchSpec;
  /** Firing voltage at the module, before any lead loss. */
  readonly voltage: number;
  /** Length of firing line from module to match, in metres. */
  readonly leadMetres: number;
}

export interface ParsedRig {
  readonly rig: Rig;
  readonly settings: RigSettings;
  readonly diagnostics: DiagnosticBag;
}

const DEFAULT_MATCH = "standard";
const DEFAULT_VOLTAGE = 24;
const DEFAULT_LEAD_METRES = 25;

interface Line {
  readonly words: readonly string[];
  readonly start: number;
  readonly end: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    const hash = raw.indexOf("#");
    const body = hash === -1 ? raw : raw.slice(0, hash);
    const words = body.split(/\s+/).filter((word) => word.length > 0);
    if (words.length > 0) {
      lines.push({ words, start: offset, end: offset + raw.length });
    }
    offset += raw.length + 1;
  }
  return lines;
}

function readNumber(word: string | undefined): number | undefined {
  if (word === undefined) {
    return undefined;
  }
  const value = Number(word);
  return Number.isFinite(value) ? value : undefined;
}

export function parseRig(text: string, name: string): ParsedRig {
  const file = new SourceFile(name, text);
  const diagnostics = new DiagnosticBag();
  const rig = new Rig();
  const fallback = matchNamed(DEFAULT_MATCH);
  if (fallback === undefined) {
    throw new Error(
      `the ${DEFAULT_MATCH} match is missing from the match list`,
    );
  }
  let match: MatchSpec = fallback;
  let voltage = DEFAULT_VOLTAGE;
  let leadMetres = DEFAULT_LEAD_METRES;

  for (const line of splitLines(text)) {
    const at = span(line.start, line.end);
    const keyword = (line.words[0] ?? "").toLowerCase();
    switch (keyword) {
      case "position": {
        const name = line.words[1] ?? "";
        const problem = checkId(name);
        if (problem) {
          diagnostics.error({
            code: "PF1200",
            message: `unusable position name, ${problem.detail}`,
            file,
            span: at,
          });
          break;
        }
        if ((line.words[2] ?? "").toLowerCase() !== "at") {
          diagnostics.error({
            code: "PF1201",
            message: "a position needs an at with two coordinates",
            file,
            span: at,
            help: "write it as position pad.a at 0 0",
          });
          break;
        }
        const east = readNumber(line.words[3]);
        const north = readNumber(line.words[4]);
        if (east === undefined || north === undefined) {
          diagnostics.error({
            code: "PF1202",
            message: `position ${name} has coordinates that are not numbers`,
            file,
            span: at,
          });
          break;
        }
        const note = line.words.slice(5).join(" ");
        rig.addPosition(
          note.length > 0
            ? firingPosition(positionId(name), east, north, note)
            : firingPosition(positionId(name), east, north),
        );
        break;
      }
      case "module": {
        const number = readNumber(line.words[1]);
        if (number === undefined || !Number.isInteger(number) || number < 1) {
          diagnostics.error({
            code: "PF1203",
            message: "a module needs a whole case number above zero",
            file,
            span: at,
          });
          break;
        }
        const model = modelNamed(line.words[2] ?? "");
        if (model === undefined) {
          diagnostics.error({
            code: "PF1204",
            message: `unknown module model ${line.words[2] ?? "(blank)"}`,
            file,
            span: at,
          });
          break;
        }
        if ((line.words[3] ?? "").toLowerCase() !== "at") {
          diagnostics.error({
            code: "PF1205",
            message: "a module needs an at with a position",
            file,
            span: at,
            help: "write it as module 1 fc-32 at pad.a",
          });
          break;
        }
        const where = line.words[4] ?? "";
        if (checkId(where) !== undefined) {
          diagnostics.error({
            code: "PF1206",
            message: `module ${number} names an unusable position`,
            file,
            span: at,
          });
          break;
        }
        if (rig.module(number) !== undefined) {
          diagnostics.warning({
            code: "PF1207",
            message: `module ${number} is defined twice, the later one wins`,
            file,
            span: at,
          });
        }
        const note = line.words.slice(5).join(" ");
        rig.addModule(
          note.length > 0
            ? firingModule(number, model, positionId(where), note)
            : firingModule(number, model, positionId(where)),
        );
        break;
      }
      case "match": {
        const spec = matchNamed(line.words[1] ?? "");
        if (spec === undefined) {
          diagnostics.error({
            code: "PF1208",
            message: `unknown match type ${line.words[1] ?? "(blank)"}`,
            file,
            span: at,
          });
          break;
        }
        match = spec;
        break;
      }
      case "voltage": {
        const value = readNumber(line.words[1]);
        if (value === undefined || value <= 0) {
          diagnostics.error({
            code: "PF1209",
            message: "voltage has to be a number above zero",
            file,
            span: at,
          });
          break;
        }
        voltage = value;
        break;
      }
      case "lead": {
        const value = readNumber(line.words[1]);
        if (value === undefined || value < 0) {
          diagnostics.error({
            code: "PF1210",
            message: "lead length has to be a number of metres",
            file,
            span: at,
          });
          break;
        }
        leadMetres = value;
        break;
      }
      default: {
        diagnostics.error({
          code: "PF1211",
          message: `unknown rig statement ${keyword}`,
          file,
          span: at,
          help: "the statements are position, module, match, voltage and lead",
        });
      }
    }
  }

  for (const missing of rig.undefinedPositions()) {
    diagnostics.error({
      code: "PF1212",
      message: `a module stands at ${missing}, which is never defined`,
      file,
    });
  }

  return { rig, settings: { match, voltage, leadMetres }, diagnostics };
}
