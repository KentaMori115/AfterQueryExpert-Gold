import { describe, expect, it } from "vitest";
import {
  DiagnosticBag,
  compareDiagnostics,
  error,
  formatBag,
  formatDiagnostic,
  isError,
  note,
  summarise,
  warning,
} from "../../src/core/diagnostic.js";
import { SourceFile, span } from "../../src/core/span.js";

const file = new SourceFile(
  "show.pf",
  ["show winter", "  cue 4.0 shell8 from pad.a", "end"].join("\n"),
);
const shellSpan = span(
  file.text.indexOf("shell8"),
  file.text.indexOf("shell8") + 6,
);

describe("constructors", () => {
  it("stamps the severity", () => {
    expect(error({ code: "PF0001", message: "no" }).severity).toBe("error");
    expect(warning({ code: "PF0002", message: "hm" }).severity).toBe("warning");
    expect(note({ code: "PF0003", message: "fyi" }).severity).toBe("note");
  });

  it("leaves optional fields off when not given", () => {
    const diagnostic = error({ code: "PF0001", message: "no" });
    expect("span" in diagnostic).toBe(false);
    expect("file" in diagnostic).toBe(false);
    expect("help" in diagnostic).toBe(false);
  });

  it("keeps optional fields when given", () => {
    const diagnostic = error({
      code: "PF0001",
      message: "unknown effect",
      span: shellSpan,
      file,
      help: "add shell8 to the catalog",
    });
    expect(diagnostic.span).toEqual(shellSpan);
    expect(diagnostic.file?.name).toBe("show.pf");
    expect(diagnostic.help).toContain("catalog");
  });

  it("recognises an error", () => {
    expect(isError(error({ code: "a", message: "m" }))).toBe(true);
    expect(isError(warning({ code: "a", message: "m" }))).toBe(false);
  });
});

describe("ordering", () => {
  it("sorts by file name first", () => {
    const other = new SourceFile("aaa.pf", "cue");
    const a = error({ code: "X", message: "m", file: other, span: span(9, 9) });
    const b = error({ code: "X", message: "m", file, span: span(0, 1) });
    expect(compareDiagnostics(a, b)).toBeLessThan(0);
  });

  it("sorts by offset within a file", () => {
    const a = error({ code: "X", message: "m", file, span: span(20, 21) });
    const b = error({ code: "X", message: "m", file, span: span(4, 5) });
    expect(compareDiagnostics(a, b)).toBeGreaterThan(0);
  });

  it("puts an error before a warning at the same offset", () => {
    const a = warning({ code: "X", message: "m", file, span: span(4, 5) });
    const b = error({ code: "X", message: "m", file, span: span(4, 5) });
    expect(compareDiagnostics(a, b)).toBeGreaterThan(0);
  });

  it("falls back to the code", () => {
    const a = error({ code: "PF0100", message: "m" });
    const b = error({ code: "PF0200", message: "m" });
    expect(compareDiagnostics(a, b)).toBeLessThan(0);
    expect(compareDiagnostics(b, a)).toBeGreaterThan(0);
    expect(compareDiagnostics(a, a)).toBe(0);
  });

  it("sinks a diagnostic with no span to the end", () => {
    const placed = error({ code: "A", message: "m", file, span: span(4, 5) });
    const floating = error({ code: "A", message: "m", file });
    expect(compareDiagnostics(floating, placed)).toBeGreaterThan(0);
  });
});

describe("DiagnosticBag", () => {
  it("counts what it holds", () => {
    const bag = new DiagnosticBag()
      .error({ code: "A", message: "one" })
      .warning({ code: "B", message: "two" })
      .note({ code: "C", message: "three" });
    expect(bag.size).toBe(3);
    expect(bag.errorCount).toBe(1);
    expect(bag.warningCount).toBe(1);
    expect(bag.hasErrors()).toBe(true);
  });

  it("is clean when it holds only warnings", () => {
    const bag = new DiagnosticBag().warning({ code: "B", message: "two" });
    expect(bag.hasErrors()).toBe(false);
  });

  it("takes a batch", () => {
    const bag = new DiagnosticBag().addAll([
      error({ code: "A", message: "one" }),
      error({ code: "B", message: "two" }),
    ]);
    expect(bag.size).toBe(2);
  });

  it("keeps insertion order in all but sorts on request", () => {
    const bag = new DiagnosticBag()
      .add(error({ code: "A", message: "late", file, span: span(20, 21) }))
      .add(error({ code: "A", message: "early", file, span: span(2, 3) }));
    expect(bag.all().map((d) => d.message)).toEqual(["late", "early"]);
    expect(bag.sorted().map((d) => d.message)).toEqual(["early", "late"]);
  });

  it("filters by severity and code", () => {
    const bag = new DiagnosticBag()
      .error({ code: "PF0100", message: "one" })
      .warning({ code: "PF0100", message: "two" })
      .warning({ code: "PF0200", message: "three" });
    expect(bag.bySeverity("warning")).toHaveLength(2);
    expect(bag.byCode("PF0100")).toHaveLength(2);
    expect(bag.byCode("nothing")).toEqual([]);
  });
});

describe("formatting", () => {
  it("names the location and shows the source", () => {
    const rendered = formatDiagnostic(
      error({
        code: "PF0210",
        message: "unknown effect shell8",
        file,
        span: shellSpan,
        help: "check the catalog name",
      }),
    );
    expect(rendered).toContain("show.pf:2:11: error PF0210");
    expect(rendered).toContain("^^^^^^");
    expect(rendered).toContain("help: check the catalog name");
  });

  it("can leave the source out", () => {
    const rendered = formatDiagnostic(
      error({ code: "PF0210", message: "m", file, span: shellSpan }),
      { showSource: false },
    );
    expect(rendered).not.toContain("^");
  });

  it("copes with no location at all", () => {
    const rendered = formatDiagnostic(error({ code: "PF0900", message: "m" }));
    expect(rendered).toBe("error PF0900: m");
  });

  it("renders a whole bag in sorted order", () => {
    const bag = new DiagnosticBag()
      .add(error({ code: "B", message: "late", file, span: span(20, 21) }))
      .add(error({ code: "A", message: "early", file, span: span(2, 3) }));
    const rendered = formatBag(bag, { showSource: false });
    expect(rendered.indexOf("early")).toBeLessThan(rendered.indexOf("late"));
  });
});

describe("summarise", () => {
  it("uses singular and plural correctly", () => {
    const one = new DiagnosticBag()
      .error({ code: "A", message: "m" })
      .warning({ code: "B", message: "m" });
    expect(summarise(one)).toBe("1 error, 1 warning");
    const many = new DiagnosticBag()
      .error({ code: "A", message: "m" })
      .error({ code: "B", message: "m" });
    expect(summarise(many)).toBe("2 errors, 0 warnings");
  });
});
