import type { Boundary, House, Point, Site } from "./site.js";
import { boundary, house, point, site } from "./site.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { SourceFile, span } from "../core/span.js";

/**
 * Reading the site sheet.
 *
 * A site comes off a survey, and the survey is a walk with a tape measure and
 * a notebook, so the sheet is written the way the rig sheet is: one statement
 * per line, no punctuation, a hash to the end of the line for a comment. The
 * coordinates are metres east and north of the same origin the rig uses,
 * which is the whole reason the two files can be checked against each other.
 *
 *   site water meadow
 *   audience -200 -150 200 -150
 *   hard river -300 120 300 140
 *   soft hedge -100 60 100 60
 *   house mill.cottage at 400 300 limit 120
 *   limit 115
 *
 * The audience line is the one statement a sheet cannot do without, because
 * every separation distance is measured to it. A boundary is hard when
 * nothing may land past it and soft when it is only drawn. A house is the
 * nearest noise sensitive property, with the peak level its licence allows;
 * a house without its own figure takes the sheet's `limit`.
 */

export interface ParsedSite {
  readonly site: Site;
  readonly diagnostics: DiagnosticBag;
}

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
  if (word === undefined || word.length === 0) {
    return undefined;
  }
  const value = Number(word);
  return Number.isFinite(value) ? value : undefined;
}

/** A run of coordinate pairs, or nothing when any of them will not read. */
function readPoints(words: readonly string[]): Point[] | undefined {
  if (words.length === 0 || words.length % 2 !== 0) {
    return undefined;
  }
  const points: Point[] = [];
  for (let i = 0; i < words.length; i += 2) {
    const east = readNumber(words[i]);
    const north = readNumber(words[i + 1]);
    if (east === undefined || north === undefined) {
      return undefined;
    }
    points.push(point(east, north));
  }
  return points;
}

/** A boundary or house name: one word that is not a number. */
function readName(word: string | undefined): string | undefined {
  if (
    word === undefined ||
    word.length === 0 ||
    readNumber(word) !== undefined
  ) {
    return undefined;
  }
  return word;
}

export function parseSite(text: string, name: string): ParsedSite {
  const file = new SourceFile(name, text);
  const diagnostics = new DiagnosticBag();
  let siteName: string | undefined;
  let spectatorLine: Boundary | undefined;
  const boundaries: Boundary[] = [];
  const houses: House[] = [];
  let sheetLimit: number | undefined;

  for (const line of splitLines(text)) {
    const at = span(line.start, line.end);
    const keyword = (line.words[0] ?? "").toLowerCase();
    switch (keyword) {
      case "site": {
        siteName = line.words.slice(1).join(" ");
        break;
      }
      case "audience": {
        const points = readPoints(line.words.slice(1));
        if (points === undefined || points.length < 2) {
          diagnostics.error({
            code: "PF1702",
            message:
              "the audience line needs at least two points as east north pairs",
            file,
            span: at,
            help: "write it as audience -200 -150 200 -150",
          });
          break;
        }
        if (spectatorLine !== undefined) {
          diagnostics.error({
            code: "PF1701",
            message: "a site has one audience line and this sheet has two",
            file,
            span: at,
            help: "join them into one line with more points",
          });
          break;
        }
        spectatorLine = boundary("spectator line", points);
        break;
      }
      case "hard":
      case "soft": {
        const lineName = readName(line.words[1]);
        if (lineName === undefined) {
          diagnostics.error({
            code: "PF1703",
            message: `a ${keyword} boundary needs a name before its points`,
            file,
            span: at,
            help: `write it as ${keyword} river -300 120 300 140`,
          });
          break;
        }
        const points = readPoints(line.words.slice(2));
        if (points === undefined || points.length < 2) {
          diagnostics.error({
            code: "PF1702",
            message: `boundary ${lineName} needs at least two points as east north pairs`,
            file,
            span: at,
          });
          break;
        }
        boundaries.push(boundary(lineName, points, keyword === "hard"));
        break;
      }
      case "house": {
        const houseName = readName(line.words[1]);
        if (houseName === undefined || houseName.toLowerCase() === "at") {
          diagnostics.error({
            code: "PF1704",
            message: "a house needs a name before its position",
            file,
            span: at,
            help: "write it as house mill.cottage at 400 300 limit 120",
          });
          break;
        }
        const east = readNumber(line.words[3]);
        const north = readNumber(line.words[4]);
        if (
          (line.words[2] ?? "").toLowerCase() !== "at" ||
          east === undefined ||
          north === undefined
        ) {
          diagnostics.error({
            code: "PF1705",
            message: `house ${houseName} needs an at with two coordinates`,
            file,
            span: at,
            help: "write it as house mill.cottage at 400 300",
          });
          break;
        }
        let limit: number | undefined;
        const rest = line.words.slice(5);
        if (rest.length > 0) {
          const value =
            (rest[0] ?? "").toLowerCase() === "limit"
              ? readNumber(rest[1])
              : undefined;
          if (value === undefined || value <= 0 || rest.length !== 2) {
            diagnostics.error({
              code: "PF1706",
              message: `house ${houseName} has a limit that is not a number of decibels`,
              file,
              span: at,
              help: "write it as limit 120, or leave it off to take the sheet's limit",
            });
            break;
          }
          limit = value;
        }
        houses.push(
          limit === undefined
            ? house(houseName, east, north)
            : house(houseName, east, north, limit),
        );
        break;
      }
      case "limit": {
        const value = readNumber(line.words[1]);
        if (value === undefined || value <= 0 || line.words.length !== 2) {
          diagnostics.error({
            code: "PF1706",
            message: "limit has to be a number of decibels above zero",
            file,
            span: at,
          });
          break;
        }
        sheetLimit = value;
        break;
      }
      default: {
        diagnostics.error({
          code: "PF1707",
          message: `unknown site statement ${keyword}`,
          file,
          span: at,
          help: "the statements are site, audience, hard, soft, house and limit",
        });
      }
    }
  }

  if (spectatorLine === undefined) {
    diagnostics.error({
      code: "PF1700",
      message: `${name} has no audience line, and every separation is measured to it`,
      file,
      help: "add a line like audience -200 -150 200 -150",
    });
    // A placeholder so the caller gets a site shaped object back with the
    // errors; a site with errors is not one anything should fire against.
    spectatorLine = boundary("spectator line", [point(0, 0), point(0, 0)]);
  }

  // The sheet's limit reaches every house that did not name its own, whatever
  // order the lines were written in.
  const settled = houses.map((held) =>
    held.limit === undefined && sheetLimit !== undefined
      ? house(held.name, held.at.east, held.at.north, sheetLimit)
      : held,
  );

  return {
    site: site(siteName ?? name, spectatorLine, boundaries, settled),
    diagnostics,
  };
}

/** The statements a sheet may hold, for a help screen or a completion. */
export const SITE_STATEMENTS: readonly string[] = [
  "site",
  "audience",
  "hard",
  "soft",
  "house",
  "limit",
];
