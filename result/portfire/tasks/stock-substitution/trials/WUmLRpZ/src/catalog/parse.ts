import { parseCalibre } from "./calibre.js";
import type { BreakStyle, Effect } from "./effect.js";
import { GROUND_STYLES, isBreakStyle, isGroundStyle, shell } from "./effect.js";
import { Catalog } from "./registry.js";
import { readTable } from "../core/csv.js";
import type { CsvRecord } from "../core/csv.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { checkId, effectId } from "../core/ids.js";
import { parseShowTime } from "../core/timecode.js";
import { metres, ms } from "../core/units.js";
import type { Metres, Milliseconds } from "../core/units.js";

/**
 * Reading a house catalog off a spreadsheet.
 *
 * Every crew keeps its catalog in a spreadsheet, because a spreadsheet is the
 * only tool the whole crew already has. So the reader has to be forgiving
 * about layout and unforgiving about content. A missing column is fine if
 * nothing needs it. A shell with no calibre is not, because everything about a
 * shell is read off its calibre and there is no safe default.
 */

export interface ParsedCatalog {
  readonly catalog: Catalog;
  readonly diagnostics: DiagnosticBag;
}

function field(record: CsvRecord, name: string): string {
  return (record.values.get(name) ?? "").trim();
}

function optionalNumber(text: string): number | undefined {
  if (text.length === 0) {
    return undefined;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function optionalDuration(text: string): Milliseconds | undefined {
  return text.length === 0 ? undefined : parseShowTime(text);
}

function optionalMetres(text: string): Metres | undefined {
  const value = optionalNumber(text);
  return value === undefined || value < 0 ? undefined : metres(value);
}

export function parseCatalog(text: string, source: string): ParsedCatalog {
  const diagnostics = new DiagnosticBag();
  const catalog = new Catalog();
  const table = readTable(text);

  if (table.headers.length === 0) {
    diagnostics.error({
      code: "PF1000",
      message: `${source} has no header row`,
      help: "the first row names the columns, starting with id and kind",
    });
    return { catalog, diagnostics };
  }
  for (const required of ["id", "kind", "name"]) {
    if (!table.headers.includes(required)) {
      diagnostics.error({
        code: "PF1001",
        message: `${source} has no ${required} column`,
      });
    }
  }
  if (diagnostics.hasErrors()) {
    return { catalog, diagnostics };
  }

  for (const record of table.records) {
    const where = `${source} line ${record.line}`;
    const id = field(record, "id");
    const problem = checkId(id);
    if (problem) {
      diagnostics.error({
        code: "PF1002",
        message: `${where} has an unusable id, ${problem.detail}`,
      });
      continue;
    }
    if (catalog.has(id)) {
      diagnostics.error({
        code: "PF1003",
        message: `${where} repeats the id ${id}`,
        help: "two effects cannot share a name, the later one would win",
      });
      continue;
    }
    const effect = readEffect(record, where, diagnostics);
    if (effect !== undefined) {
      catalog.add(effect, source);
    }
  }
  return { catalog, diagnostics };
}

function readEffect(
  record: CsvRecord,
  where: string,
  diagnostics: DiagnosticBag,
): Effect | undefined {
  const id = effectId(field(record, "id"));
  const name = field(record, "name") || id;
  const maker = field(record, "maker");
  const kind = field(record, "kind").toLowerCase();

  if (kind === "ground") {
    const style = field(record, "style").toLowerCase();
    if (!isGroundStyle(style)) {
      diagnostics.error({
        code: "PF1010",
        message: `${where} has no usable ground style`,
        help: `use one of ${GROUND_STYLES.join(", ")}`,
      });
      return undefined;
    }
    const duration = optionalDuration(field(record, "duration"));
    if (duration === undefined) {
      diagnostics.error({
        code: "PF1011",
        message: `${where} is a ground piece with no burn duration`,
      });
      return undefined;
    }
    const piece: Effect = {
      kind: "ground",
      id,
      name,
      style,
      duration,
      height: optionalMetres(field(record, "height")) ?? metres(4),
    };
    return maker.length > 0 ? { ...piece, maker } : piece;
  }

  const size = parseCalibre(field(record, "calibre"));
  if (size === undefined) {
    diagnostics.error({
      code: "PF1012",
      message: `${where} has no readable calibre`,
      help: "write it as 150mm or 6in, everything else is read off it",
    });
    return undefined;
  }

  switch (kind) {
    case "shell": {
      const style = field(record, "break").toLowerCase();
      const known = isBreakStyle(style);
      if (style.length > 0 && !known) {
        diagnostics.warning({
          code: "PF1013",
          message: `${where} has an unknown break style ${style}`,
          help: "the cue sheet will print it, nothing else reads it",
        });
      }
      const hang = optionalDuration(field(record, "hang"));
      const diameter = optionalMetres(field(record, "diameter"));
      const init: {
        id: typeof id;
        name: string;
        calibre: typeof size;
        breakStyle?: BreakStyle;
        hangTime?: Milliseconds;
        breakDiameter?: Metres;
        maker?: string;
      } = { id, name, calibre: size };
      if (known) {
        init.breakStyle = style;
      }
      if (hang !== undefined) {
        init.hangTime = hang;
      }
      if (diameter !== undefined) {
        init.breakDiameter = diameter;
      }
      if (maker.length > 0) {
        init.maker = maker;
      }
      return shell(init);
    }
    case "cake":
    case "candle": {
      const shots = optionalNumber(field(record, "shots"));
      if (shots === undefined || shots < 1 || !Number.isInteger(shots)) {
        diagnostics.error({
          code: "PF1014",
          message: `${where} is a ${kind} with no whole shot count`,
        });
        return undefined;
      }
      const interval = optionalDuration(field(record, "interval")) ?? ms(200);
      const base = { id, name, calibre: size, shots, shotInterval: interval };
      const effect: Effect =
        kind === "cake"
          ? {
              kind: "cake",
              ...base,
              hangTime: optionalDuration(field(record, "hang")) ?? ms(1200),
            }
          : {
              kind: "candle",
              ...base,
              height: optionalMetres(field(record, "height")) ?? metres(40),
            };
      return maker.length > 0 ? { ...effect, maker } : effect;
    }
    case "mine": {
      const effect: Effect = {
        kind: "mine",
        id,
        name,
        calibre: size,
        spreadAngle: optionalNumber(field(record, "spread")) ?? 40,
        height: optionalMetres(field(record, "height")) ?? metres(30),
        hangTime: optionalDuration(field(record, "hang")) ?? ms(1800),
      };
      return maker.length > 0 ? { ...effect, maker } : effect;
    }
    default: {
      diagnostics.error({
        code: "PF1015",
        message: `${where} has an unknown kind ${kind || "(blank)"}`,
        help: "use shell, cake, mine, candle or ground",
      });
      return undefined;
    }
  }
}
