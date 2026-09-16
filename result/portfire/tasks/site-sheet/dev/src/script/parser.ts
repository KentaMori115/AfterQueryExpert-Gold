import type { CueStatement, PinChoice, Script, Statement } from "./ast.js";
import { isCueStatement } from "./ast.js";
import type { Token } from "./token.js";
import { byLine, describeToken, lex } from "./token.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { checkId } from "../core/ids.js";
import { parsePin } from "../rig/pin.js";
import type { SourceFile } from "../core/span.js";
import { joinSpans } from "../core/span.js";
import { parseShowTime } from "../core/timecode.js";
import { metres } from "../core/units.js";
import type { Metres, Milliseconds } from "../core/units.js";

/**
 * Turning tokens into statements.
 *
 * The parser reads one line at a time and never carries state across a line
 * except for the group it is inside. That is a deliberate limit. It means a
 * mistake on one line cannot corrupt the reading of the next, so a script with
 * six typos reports six diagnostics instead of one confusing cascade, and a
 * shooter fixes them all in one pass rather than six.
 */

interface LineCursor {
  readonly tokens: readonly Token[];
  index: number;
}

export interface ParsedScript {
  readonly script: Script;
  readonly diagnostics: DiagnosticBag;
}

/**
 * A cue script is written by hand, so a file past this is not a cue script.
 * It is a paste accident, a binary opened by mistake, or a generator that ran
 * away. Reading it would work and would take long enough that somebody kills
 * the process, which tells them nothing.
 */
export const MAX_SCRIPT_BYTES = 4 * 1024 * 1024;

/** A cue line past this many words is not a cue line either. */
export const MAX_WORDS_PER_LINE = 512;

export function parseScript(file: SourceFile): ParsedScript {
  if (file.text.length > MAX_SCRIPT_BYTES) {
    const diagnostics = new DiagnosticBag().error({
      code: "PF2120",
      message: `${file.name} is ${Math.round(file.text.length / 1024)}kB, which is not a cue script`,
      help: "a hand written show is a few tens of kilobytes at most",
    });
    return { script: { source: file.name, statements: [] }, diagnostics };
  }
  const lexed = lex(file);
  const diagnostics = new DiagnosticBag().addAll(lexed.diagnostics.all());
  const statements: Statement[] = [];
  let group: { name: string; body: CueStatement[]; token: Token } | undefined;

  for (const line of byLine(lexed.tokens)) {
    const first = line[0];
    if (first === undefined) {
      continue;
    }
    if (line.length > MAX_WORDS_PER_LINE) {
      error(
        diagnostics,
        file,
        line.slice(0, 2),
        "PF2121",
        `this line is ${line.length} words long, which is not a cue`,
      );
      continue;
    }
    const cursor: LineCursor = { tokens: line, index: 0 };
    const keyword = first.text.toLowerCase();

    if (keyword === "end") {
      if (group === undefined) {
        error(diagnostics, file, line, "PF2100", "end with no group open");
      } else {
        statements.push({
          kind: "group",
          span: joinSpans(group.token.span, first.span),
          name: group.name,
          body: group.body,
        });
        group = undefined;
      }
      continue;
    }

    if (keyword === "group") {
      cursor.index = 1;
      const name = readName(cursor, diagnostics, file, line, "group");
      if (name === undefined) {
        continue;
      }
      if (group !== undefined) {
        error(
          diagnostics,
          file,
          line,
          "PF2101",
          `group ${name} opens while ${group.name} is still open`,
          "close the first one with end",
        );
        continue;
      }
      group = { name, body: [], token: first };
      continue;
    }

    const statement = parseLine(cursor, diagnostics, file);
    if (statement === undefined) {
      continue;
    }
    if (group !== undefined) {
      if (!isCueStatement(statement)) {
        error(
          diagnostics,
          file,
          line,
          "PF2102",
          `${statement.kind} cannot sit inside a group`,
        );
        continue;
      }
      group.body.push(statement);
    } else {
      statements.push(statement);
    }
  }

  if (group !== undefined) {
    diagnostics.error({
      code: "PF2103",
      message: `group ${group.name} is never closed`,
      file,
      span: group.token.span,
      help: "every group ends with a line saying end",
    });
  }

  return { script: { source: file.name, statements }, diagnostics };
}

function error(
  diagnostics: DiagnosticBag,
  file: SourceFile,
  line: readonly Token[],
  code: string,
  message: string,
  help?: string,
): void {
  const first = line[0];
  const last = line[line.length - 1];
  if (first === undefined || last === undefined) {
    return;
  }
  diagnostics.error({
    code,
    message,
    file,
    span: joinSpans(first.span, last.span),
    ...(help === undefined ? {} : { help }),
  });
}

function peek(cursor: LineCursor): Token | undefined {
  return cursor.tokens[cursor.index];
}

function take(cursor: LineCursor): Token | undefined {
  const token = cursor.tokens[cursor.index];
  cursor.index += 1;
  return token;
}

function expectWord(cursor: LineCursor, word: string): boolean {
  const token = peek(cursor);
  if (token !== undefined && token.text.toLowerCase() === word) {
    cursor.index += 1;
    return true;
  }
  return false;
}

function readName(
  cursor: LineCursor,
  diagnostics: DiagnosticBag,
  file: SourceFile,
  line: readonly Token[],
  what: string,
): string | undefined {
  const token = take(cursor);
  if (token === undefined || token.kind !== "word") {
    error(
      diagnostics,
      file,
      line,
      "PF2104",
      `${what} needs a name, found ${token === undefined ? "nothing" : describeToken(token)}`,
    );
    return undefined;
  }
  const problem = checkId(token.text);
  if (problem) {
    error(
      diagnostics,
      file,
      line,
      "PF2105",
      `unusable name, ${problem.detail}`,
    );
    return undefined;
  }
  return token.text;
}

function readTime(
  cursor: LineCursor,
  diagnostics: DiagnosticBag,
  file: SourceFile,
  line: readonly Token[],
  what: string,
): Milliseconds | undefined {
  const token = take(cursor);
  if (token === undefined) {
    error(diagnostics, file, line, "PF2106", `${what} needs a time`);
    return undefined;
  }
  const value = parseShowTime(token.text);
  if (value === undefined) {
    error(
      diagnostics,
      file,
      line,
      "PF2107",
      `${token.text} is not a time`,
      "write it as 12.4, 1:23.450, 250ms or 4m30s",
    );
    return undefined;
  }
  return value;
}

function readCount(
  cursor: LineCursor,
  diagnostics: DiagnosticBag,
  file: SourceFile,
  line: readonly Token[],
  what: string,
): number | undefined {
  const token = take(cursor);
  const value = token === undefined ? Number.NaN : Number(token.text);
  if (!Number.isInteger(value) || value < 1) {
    error(
      diagnostics,
      file,
      line,
      "PF2108",
      `${what} needs a whole count above zero`,
    );
    return undefined;
  }
  return value;
}

interface Trailers {
  readonly pin: PinChoice;
  readonly height?: Metres;
  readonly label?: string;
  readonly jitter?: Milliseconds;
  readonly passes?: number;
}

/**
 * Read the optional clauses that can follow any cue, in any order. Keeping
 * them order free matters more than it looks, because a shooter editing a cue
 * at two in the morning writes them in whatever order they think of them.
 */
function readTrailers(
  cursor: LineCursor,
  diagnostics: DiagnosticBag,
  file: SourceFile,
  line: readonly Token[],
): Trailers {
  let pin: PinChoice = { kind: "auto" };
  let height: Metres | undefined;
  let label: string | undefined;
  let jitter: Milliseconds | undefined;
  let passes: number | undefined;

  while (cursor.index < cursor.tokens.length) {
    const token = take(cursor);
    if (token === undefined) {
      break;
    }
    switch (token.text.toLowerCase()) {
      case "pin": {
        const next = take(cursor);
        const address = next === undefined ? undefined : parsePin(next.text);
        if (address === undefined) {
          error(
            diagnostics,
            file,
            line,
            "PF2109",
            "pin needs an address like 12.04",
          );
          break;
        }
        pin = { kind: "fixed", module: address.module, pin: address.pin };
        break;
      }
      case "height": {
        const next = take(cursor);
        const value =
          next === undefined ? Number.NaN : Number.parseFloat(next.text);
        if (!Number.isFinite(value) || value < 0) {
          error(
            diagnostics,
            file,
            line,
            "PF2110",
            "height needs a number of metres",
          );
          break;
        }
        height = metres(value);
        break;
      }
      case "label": {
        const next = take(cursor);
        if (
          next === undefined ||
          (next.kind !== "word" && next.kind !== "string")
        ) {
          error(diagnostics, file, line, "PF2111", "label needs a name");
          break;
        }
        label = next.text;
        break;
      }
      case "jitter": {
        const value = readTime(cursor, diagnostics, file, line, "jitter");
        if (value !== undefined) {
          jitter = value;
        }
        break;
      }
      case "passes": {
        const value = readCount(cursor, diagnostics, file, line, "passes");
        if (value !== undefined) {
          passes = value;
        }
        break;
      }
      default: {
        error(
          diagnostics,
          file,
          line,
          "PF2112",
          `${token.text} is not a clause a cue understands`,
          "the clauses are pin, height, label, jitter and passes",
        );
      }
    }
  }
  return {
    pin,
    ...(height === undefined ? {} : { height }),
    ...(label === undefined ? {} : { label }),
    ...(jitter === undefined ? {} : { jitter }),
    ...(passes === undefined ? {} : { passes }),
  };
}

function lineSpan(line: readonly Token[]) {
  const first = line[0];
  const last = line[line.length - 1];
  return first !== undefined && last !== undefined
    ? joinSpans(first.span, last.span)
    : undefined;
}

function parseLine(
  cursor: LineCursor,
  diagnostics: DiagnosticBag,
  file: SourceFile,
): Statement | undefined {
  const line = cursor.tokens;
  const at = lineSpan(line);
  if (at === undefined) {
    return undefined;
  }
  const keyword = (take(cursor)?.text ?? "").toLowerCase();

  switch (keyword) {
    case "show": {
      const name = readName(cursor, diagnostics, file, line, "show");
      return name === undefined ? undefined : { kind: "show", span: at, name };
    }
    case "seed": {
      const seed = take(cursor);
      if (seed === undefined) {
        error(diagnostics, file, line, "PF2113", "seed needs a value");
        return undefined;
      }
      return { kind: "seed", span: at, seed: seed.text };
    }
    case "frame": {
      const token = take(cursor);
      const rate =
        token === undefined ? Number.NaN : Number.parseInt(token.text, 10);
      if (![24, 25, 30].includes(rate)) {
        error(
          diagnostics,
          file,
          line,
          "PF2114",
          "frame rate has to be 24, 25 or 30",
        );
        return undefined;
      }
      const dropFrame = expectWord(cursor, "drop");
      return { kind: "frame", span: at, rate, dropFrame };
    }
    case "include": {
      const path = take(cursor);
      if (path === undefined) {
        error(diagnostics, file, line, "PF2115", "include needs a path");
        return undefined;
      }
      return { kind: "include", span: at, path: path.text };
    }
    case "at":
      return parseCue(cursor, diagnostics, file, at);
    default: {
      error(
        diagnostics,
        file,
        line,
        "PF2116",
        `${keyword || "this line"} is not a statement portfire knows`,
        "a cue line starts with at, everything else is show, seed, frame, group or include",
      );
      return undefined;
    }
  }
}

function parseCue(
  cursor: LineCursor,
  diagnostics: DiagnosticBag,
  file: SourceFile,
  at: ReturnType<typeof joinSpans>,
): CueStatement | undefined {
  const line = cursor.tokens;
  const when = readTime(cursor, diagnostics, file, line, "a cue");
  if (when === undefined) {
    return undefined;
  }
  const verb = (take(cursor)?.text ?? "").toLowerCase();

  switch (verb) {
    case "fire": {
      const effect = readName(cursor, diagnostics, file, line, "fire");
      if (
        effect === undefined ||
        !expectFrom(cursor, diagnostics, file, line)
      ) {
        return undefined;
      }
      const position = readName(cursor, diagnostics, file, line, "from");
      if (position === undefined) {
        return undefined;
      }
      const trailers = readTrailers(cursor, diagnostics, file, line);
      return {
        kind: "fire",
        span: at,
        at: when,
        effect,
        position,
        pin: trailers.pin,
        ...(trailers.height === undefined ? {} : { height: trailers.height }),
        ...(trailers.label === undefined ? {} : { label: trailers.label }),
      };
    }
    case "ripple":
    case "fan": {
      const count = readCount(cursor, diagnostics, file, line, verb);
      if (
        count === undefined ||
        !expectWordOr(cursor, diagnostics, file, line, "of")
      ) {
        return undefined;
      }
      const effect = readName(cursor, diagnostics, file, line, verb);
      if (
        effect === undefined ||
        !expectFrom(cursor, diagnostics, file, line)
      ) {
        return undefined;
      }
      const position = readName(cursor, diagnostics, file, line, "from");
      if (position === undefined) {
        return undefined;
      }
      const gapWord = verb === "ripple" ? "every" : "spread";
      if (!expectWordOr(cursor, diagnostics, file, line, gapWord)) {
        return undefined;
      }
      const gap = readTime(cursor, diagnostics, file, line, gapWord);
      if (gap === undefined) {
        return undefined;
      }
      const trailers = readTrailers(cursor, diagnostics, file, line);
      const shared = {
        span: at,
        at: when,
        count,
        effect,
        position,
        ...(trailers.jitter === undefined ? {} : { jitter: trailers.jitter }),
        ...(trailers.label === undefined ? {} : { label: trailers.label }),
      };
      return verb === "ripple"
        ? { kind: "ripple", ...shared, every: gap }
        : { kind: "fan", ...shared, spread: gap };
    }
    case "chase": {
      const effect = readName(cursor, diagnostics, file, line, "chase");
      if (
        effect === undefined ||
        !expectWordOr(cursor, diagnostics, file, line, "across")
      ) {
        return undefined;
      }
      const positions: string[] = [];
      while (
        peek(cursor)?.kind === "word" &&
        peek(cursor)?.text.toLowerCase() !== "every"
      ) {
        const name = readName(cursor, diagnostics, file, line, "across");
        if (name === undefined) {
          return undefined;
        }
        positions.push(name);
      }
      if (positions.length < 2) {
        error(
          diagnostics,
          file,
          line,
          "PF2117",
          "a chase needs at least two positions to run across",
        );
        return undefined;
      }
      if (!expectWordOr(cursor, diagnostics, file, line, "every")) {
        return undefined;
      }
      const every = readTime(cursor, diagnostics, file, line, "every");
      if (every === undefined) {
        return undefined;
      }
      const trailers = readTrailers(cursor, diagnostics, file, line);
      return {
        kind: "chase",
        span: at,
        at: when,
        effect,
        positions,
        every,
        passes: trailers.passes ?? 1,
        ...(trailers.label === undefined ? {} : { label: trailers.label }),
      };
    }
    case "play": {
      const group = readName(cursor, diagnostics, file, line, "play");
      return group === undefined
        ? undefined
        : { kind: "play", span: at, at: when, group };
    }
    default: {
      error(
        diagnostics,
        file,
        line,
        "PF2118",
        `${verb || "this cue"} is not something a cue can do`,
        "a cue does fire, ripple, fan, chase or play",
      );
      return undefined;
    }
  }
}

function expectFrom(
  cursor: LineCursor,
  diagnostics: DiagnosticBag,
  file: SourceFile,
  line: readonly Token[],
): boolean {
  return expectWordOr(cursor, diagnostics, file, line, "from");
}

function expectWordOr(
  cursor: LineCursor,
  diagnostics: DiagnosticBag,
  file: SourceFile,
  line: readonly Token[],
  word: string,
): boolean {
  if (expectWord(cursor, word)) {
    return true;
  }
  const token = peek(cursor);
  error(
    diagnostics,
    file,
    line,
    "PF2119",
    `expected ${word}, found ${token === undefined ? "the end of the line" : describeToken(token)}`,
  );
  return false;
}

export const CUE_VERBS = ["fire", "ripple", "fan", "chase", "play"] as const;
export const TRAILER_CLAUSES = [
  "pin",
  "height",
  "label",
  "jitter",
  "passes",
] as const;
