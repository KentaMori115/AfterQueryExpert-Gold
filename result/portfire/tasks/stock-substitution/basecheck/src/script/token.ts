import type { SourceFile, Span } from "../core/span.js";
import { span } from "../core/span.js";
import { DiagnosticBag } from "../core/diagnostic.js";

/**
 * Turning a cue script into tokens.
 *
 * The script language is written by hand on a laptop in a van, so it is line
 * oriented, has no punctuation to balance, and treats a hash as a comment to
 * the end of the line. Line breaks are significant, because one line is one
 * statement, and swallowing them would make a missing keyword look like a
 * continuation rather than the mistake it is.
 *
 * Numbers and times are separate kinds even though `12.4` could be either.
 * The parser decides which it wanted, and keeping them apart means a time
 * written as `1:23.450` never has to be re-lexed once the parser knows.
 */

export type TokenKind =
  | "word"
  | "number"
  | "time"
  | "string"
  | "newline"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  /** The text as written, without quotes for a string. */
  readonly text: string;
  readonly span: Span;
}

const WORD_START = /[A-Za-z_]/;
const WORD_BODY = /[A-Za-z0-9._-]/;
const DIGIT = /[0-9]/;

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: DiagnosticBag;
}

export function lex(file: SourceFile): LexResult {
  const text = file.text;
  const tokens: Token[] = [];
  const diagnostics = new DiagnosticBag();
  let i = 0;

  const push = (kind: TokenKind, start: number, end: number, body?: string) => {
    tokens.push({
      kind,
      text: body ?? text.slice(start, end),
      span: span(start, end),
    });
  };

  while (i < text.length) {
    const char = text[i];
    if (char === undefined) {
      break;
    }
    if (char === "\n") {
      push("newline", i, i + 1, "\n");
      i += 1;
      continue;
    }
    if (char === "\r" || char === " " || char === "\t") {
      i += 1;
      continue;
    }
    if (char === "#") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (char === '"') {
      const start = i;
      i += 1;
      let body = "";
      let closed = false;
      while (i < text.length) {
        const inner = text[i];
        if (inner === undefined || inner === "\n") {
          break;
        }
        if (inner === '"') {
          closed = true;
          i += 1;
          break;
        }
        if (inner === "\\" && text[i + 1] === '"') {
          body += '"';
          i += 2;
          continue;
        }
        body += inner;
        i += 1;
      }
      if (!closed) {
        diagnostics.error({
          code: "PF2000",
          message: "a quoted string runs off the end of its line",
          file,
          span: span(start, i),
        });
      }
      push("string", start, i, body);
      continue;
    }
    if (DIGIT.test(char) || (char === "-" && DIGIT.test(text[i + 1] ?? ""))) {
      const start = i;
      if (char === "-") {
        i += 1;
      }
      while (i < text.length && DIGIT.test(text[i] ?? "")) {
        i += 1;
      }
      let isTime = false;
      if (text[i] === ":") {
        isTime = true;
        i += 1;
        while (i < text.length && DIGIT.test(text[i] ?? "")) {
          i += 1;
        }
      }
      if (text[i] === "." && DIGIT.test(text[i + 1] ?? "")) {
        i += 1;
        while (i < text.length && DIGIT.test(text[i] ?? "")) {
          i += 1;
        }
      }
      // A trailing unit suffix belongs to the number, so `250ms` is one token.
      while (i < text.length && /[a-z]/.test(text[i] ?? "")) {
        i += 1;
      }
      push(isTime ? "time" : "number", start, i);
      continue;
    }
    if (WORD_START.test(char)) {
      const start = i;
      while (i < text.length && WORD_BODY.test(text[i] ?? "")) {
        i += 1;
      }
      push("word", start, i);
      continue;
    }
    diagnostics.error({
      code: "PF2001",
      message: `${char} has no meaning in a cue script`,
      file,
      span: span(i, i + 1),
    });
    i += 1;
  }
  push("eof", text.length, text.length, "");
  return { tokens, diagnostics };
}

/** Drop newline tokens, for a caller that wants the words alone. */
export function withoutNewlines(tokens: readonly Token[]): Token[] {
  return tokens.filter((token) => token.kind !== "newline");
}

/** Split tokens into one list per line, dropping the newlines themselves. */
export function byLine(tokens: readonly Token[]): Token[][] {
  const lines: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.kind === "newline") {
      if (current.length > 0) {
        lines.push(current);
        current = [];
      }
      continue;
    }
    if (token.kind === "eof") {
      break;
    }
    current.push(token);
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

export function describeToken(token: Token): string {
  if (token.kind === "eof") {
    return "the end of the file";
  }
  if (token.kind === "newline") {
    return "the end of the line";
  }
  return token.text;
}
