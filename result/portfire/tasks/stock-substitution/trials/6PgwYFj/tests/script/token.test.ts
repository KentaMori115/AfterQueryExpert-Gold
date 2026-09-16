import { describe, expect, it } from "vitest";
import {
  byLine,
  describeToken,
  lex,
  withoutNewlines,
} from "../../src/script/token.js";
import { SourceFile } from "../../src/core/span.js";

function kindsOf(source: string): string[] {
  const { tokens } = lex(new SourceFile("s.pf", source));
  return withoutNewlines(tokens)
    .filter((token) => token.kind !== "eof")
    .map((token) => token.kind);
}

function textsOf(source: string): string[] {
  const { tokens } = lex(new SourceFile("s.pf", source));
  return withoutNewlines(tokens)
    .filter((token) => token.kind !== "eof")
    .map((token) => token.text);
}

describe("words", () => {
  it("reads a dotted name as one word", () => {
    expect(textsOf("fire shell.150.palm")).toEqual(["fire", "shell.150.palm"]);
  });

  it("allows hyphens and underscores inside a word", () => {
    expect(textsOf("autumn-2025 pad_a")).toEqual(["autumn-2025", "pad_a"]);
  });

  it("does not start a word with a digit", () => {
    expect(kindsOf("4shots")).toEqual(["number"]);
  });
});

describe("numbers and times", () => {
  it("reads a whole number", () => {
    expect(kindsOf("12")).toEqual(["number"]);
  });

  it("reads a decimal", () => {
    expect(textsOf("12.400")).toEqual(["12.400"]);
    expect(kindsOf("12.400")).toEqual(["number"]);
  });

  it("reads a colon form as a time", () => {
    expect(kindsOf("1:23.450")).toEqual(["time"]);
    expect(textsOf("1:23.450")).toEqual(["1:23.450"]);
  });

  it("reads a negative number", () => {
    expect(textsOf("-2.5")).toEqual(["-2.5"]);
  });

  it("keeps a unit suffix on the number", () => {
    expect(textsOf("250ms 4s")).toEqual(["250ms", "4s"]);
    expect(kindsOf("250ms")).toEqual(["number"]);
  });

  it("does not swallow a trailing dot into the number", () => {
    const { diagnostics } = lex(new SourceFile("s.pf", "12."));
    expect(textsOf("12.")).toEqual(["12"]);
    expect(diagnostics.byCode("PF2001")).toHaveLength(1);
  });
});

describe("strings", () => {
  it("reads a quoted string without its quotes", () => {
    expect(textsOf('"behind the water"')).toEqual(["behind the water"]);
  });

  it("takes an escaped quote", () => {
    expect(textsOf('"say \\"go\\""')).toEqual(['say "go"']);
  });

  it("complains about a string that runs off the line", () => {
    const { diagnostics } = lex(new SourceFile("s.pf", '"unclosed\nnext'));
    expect(diagnostics.byCode("PF2000")).toHaveLength(1);
  });

  it("still produces a token for the broken string", () => {
    expect(textsOf('"unclosed')).toEqual(["unclosed"]);
  });
});

describe("comments and whitespace", () => {
  it("drops everything after a hash", () => {
    expect(textsOf("fire shell # a six inch")).toEqual(["fire", "shell"]);
  });

  it("keeps the newline after a comment", () => {
    const { tokens } = lex(new SourceFile("s.pf", "a # note\nb"));
    expect(tokens.filter((token) => token.kind === "newline")).toHaveLength(1);
  });

  it("ignores tabs and carriage returns", () => {
    expect(textsOf("a\t\r b")).toEqual(["a", "b"]);
  });
});

describe("line structure", () => {
  it("keeps newlines as tokens", () => {
    const { tokens } = lex(new SourceFile("s.pf", "a\nb"));
    expect(tokens.map((token) => token.kind)).toEqual([
      "word",
      "newline",
      "word",
      "eof",
    ]);
  });

  it("groups tokens by line", () => {
    const { tokens } = lex(new SourceFile("s.pf", "at 12.4 fire a\nend"));
    const lines = byLine(tokens);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.map((token) => token.text)).toEqual([
      "at",
      "12.4",
      "fire",
      "a",
    ]);
  });

  it("drops blank lines when grouping", () => {
    const { tokens } = lex(new SourceFile("s.pf", "a\n\n\nb"));
    expect(byLine(tokens)).toHaveLength(2);
  });

  it("groups an empty file into nothing", () => {
    const { tokens } = lex(new SourceFile("s.pf", ""));
    expect(byLine(tokens)).toEqual([]);
  });
});

describe("spans", () => {
  it("points at the exact text of a token", () => {
    const file = new SourceFile("s.pf", "at 12.4 fire shell.150");
    const { tokens } = lex(file);
    const effect = tokens.find((token) => token.text === "shell.150");
    expect(file.slice(effect!.span)).toBe("shell.150");
  });

  it("ends the file with an eof at the last offset", () => {
    const { tokens } = lex(new SourceFile("s.pf", "abc"));
    const eof = tokens[tokens.length - 1];
    expect(eof?.kind).toBe("eof");
    expect(eof?.span.start).toBe(3);
  });
});

describe("junk", () => {
  it("complains about a character with no meaning and carries on", () => {
    const { tokens, diagnostics } = lex(new SourceFile("s.pf", "a ? b"));
    expect(diagnostics.byCode("PF2001")).toHaveLength(1);
    expect(withoutNewlines(tokens).map((token) => token.text)).toEqual([
      "a",
      "b",
      "",
    ]);
  });
});

describe("describeToken", () => {
  it("names the invisible tokens in words", () => {
    const { tokens } = lex(new SourceFile("s.pf", "a\n"));
    expect(describeToken(tokens[0]!)).toBe("a");
    expect(describeToken(tokens[1]!)).toBe("the end of the line");
    expect(describeToken(tokens[2]!)).toBe("the end of the file");
  });
});
