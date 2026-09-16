import { DiagnosticCode } from "../diagnostics/codes.js";
import { diagnostic } from "../diagnostics/diagnostic.js";
import { sourceLocation } from "../location/source-location.js";
import type { Diagnostic, LogicalPath, SourceLocation } from "../types.js";
import type { ParsedDocument } from "../yaml/parse-yaml.js";

class JsonSyntaxError extends Error {
  public constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
    public readonly code: string = DiagnosticCode.PARSE_ERROR,
  ) {
    super(message);
  }
}

class JsonReader {
  private index = 0;
  private line = 1;
  private column = 1;

  public constructor(private readonly text: string) {}

  public get position(): SourceLocation {
    return { path: "", line: this.line, column: this.column };
  }

  public peek(): string {
    return this.text[this.index] ?? "";
  }

  public eof(): boolean {
    return this.index >= this.text.length;
  }

  public advance(): string {
    const char = this.text[this.index] ?? "";
    this.index += 1;
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return char;
  }

  public skipTrivia(): void {
    while (!this.eof()) {
      const char = this.peek();
      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        this.advance();
        continue;
      }
      break;
    }
  }

  public expect(char: string): void {
    if (this.peek() !== char) {
      throw new JsonSyntaxError(`expected ${char}`, this.line, this.column);
    }
    this.advance();
  }
}

function parseString(reader: JsonReader): string {
  reader.expect('"');
  let value = "";
  while (!reader.eof()) {
    const char = reader.advance();
    if (char === '"') {
      return value;
    }
    if (char === "\\") {
      const escaped = reader.advance();
      const map: Record<string, string> = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      if (escaped === "u") {
        const hex = reader.advance() + reader.advance() + reader.advance() + reader.advance();
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new JsonSyntaxError(
            "invalid unicode escape",
            reader.position.line,
            reader.position.column,
          );
        }
        value += String.fromCharCode(Number.parseInt(hex, 16));
        continue;
      }
      const mapped = map[escaped];
      if (mapped === undefined) {
        throw new JsonSyntaxError("invalid escape", reader.position.line, reader.position.column);
      }
      value += mapped;
      continue;
    }
    if (char === "") {
      break;
    }
    value += char;
  }
  throw new JsonSyntaxError("unterminated string", reader.position.line, reader.position.column);
}

function parseNumber(reader: JsonReader): number {
  const startLine = reader.position.line;
  const startColumn = reader.position.column;
  let raw = "";
  if (reader.peek() === "-") {
    raw += reader.advance();
  }
  while (/[0-9]/.test(reader.peek())) {
    raw += reader.advance();
  }
  if (reader.peek() === ".") {
    raw += reader.advance();
    while (/[0-9]/.test(reader.peek())) {
      raw += reader.advance();
    }
  }
  if (reader.peek() === "e" || reader.peek() === "E") {
    raw += reader.advance();
    if (reader.peek() === "+" || reader.peek() === "-") {
      raw += reader.advance();
    }
    while (/[0-9]/.test(reader.peek())) {
      raw += reader.advance();
    }
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || raw.length === 0) {
    throw new JsonSyntaxError("invalid number", startLine, startColumn);
  }
  return value;
}

function parseKeyword(reader: JsonReader, keyword: string, value: unknown): unknown {
  for (const char of keyword) {
    if (reader.advance() !== char) {
      throw new JsonSyntaxError(
        `expected ${keyword}`,
        reader.position.line,
        reader.position.column,
      );
    }
  }
  return value;
}

function parseArray(reader: JsonReader): unknown[] {
  reader.expect("[");
  reader.skipTrivia();
  const items: unknown[] = [];
  if (reader.peek() === "]") {
    reader.advance();
    return items;
  }
  while (!reader.eof()) {
    items.push(parseValue(reader));
    reader.skipTrivia();
    if (reader.peek() === "]") {
      reader.advance();
      return items;
    }
    reader.expect(",");
    reader.skipTrivia();
  }
  throw new JsonSyntaxError("unterminated array", reader.position.line, reader.position.column);
}

function parseObject(reader: JsonReader): Record<string, unknown> {
  reader.expect("{");
  reader.skipTrivia();
  const record: Record<string, unknown> = {};
  if (reader.peek() === "}") {
    reader.advance();
    return record;
  }
  while (!reader.eof()) {
    if (reader.peek() !== '"') {
      throw new JsonSyntaxError(
        "expected object key",
        reader.position.line,
        reader.position.column,
      );
    }
    const keyLine = reader.position.line;
    const keyColumn = reader.position.column;
    const key = parseString(reader);
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw new JsonSyntaxError(
        `duplicate key "${key}"`,
        keyLine,
        keyColumn,
        DiagnosticCode.DUPLICATE_KEY,
      );
    }
    reader.skipTrivia();
    reader.expect(":");
    reader.skipTrivia();
    record[key] = parseValue(reader);
    reader.skipTrivia();
    if (reader.peek() === "}") {
      reader.advance();
      return record;
    }
    reader.expect(",");
    reader.skipTrivia();
  }
  throw new JsonSyntaxError("unterminated object", reader.position.line, reader.position.column);
}

function parseValue(reader: JsonReader): unknown {
  reader.skipTrivia();
  const char = reader.peek();
  if (char === '"') {
    return parseString(reader);
  }
  if (char === "{") {
    return parseObject(reader);
  }
  if (char === "[") {
    return parseArray(reader);
  }
  if (char === "t") {
    return parseKeyword(reader, "true", true);
  }
  if (char === "f") {
    return parseKeyword(reader, "false", false);
  }
  if (char === "n") {
    return parseKeyword(reader, "null", null);
  }
  if (char === "-" || /[0-9]/.test(char)) {
    return parseNumber(reader);
  }
  throw new JsonSyntaxError("unexpected token", reader.position.line, reader.position.column);
}

export function parseJsonDocument(path: LogicalPath, text: string): ParsedDocument {
  const reader = new JsonReader(text);
  try {
    const data = parseValue(reader);
    reader.skipTrivia();
    if (!reader.eof()) {
      throw new JsonSyntaxError(
        "unexpected trailing input",
        reader.position.line,
        reader.position.column,
      );
    }
    return {
      data,
      location: sourceLocation(path, 1, 1),
      diagnostics: [],
    };
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      const diagnostics: Diagnostic[] = [
        diagnostic(
          error.code,
          "error",
          error.message,
          sourceLocation(path, error.line, error.column),
        ),
      ];
      return { data: undefined, location: sourceLocation(path), diagnostics };
    }
    throw error;
  }
}
