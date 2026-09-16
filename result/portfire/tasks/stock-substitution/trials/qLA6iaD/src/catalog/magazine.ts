import { Magazine } from "./inventory.js";
import type { Lot } from "./inventory.js";
import { readTable } from "../core/csv.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { checkId } from "../core/ids.js";

/**
 * Reading the magazine book off a spreadsheet.
 *
 * The magazine book is a legal record. Every lot that comes in gets a row, and
 * the row has to survive an inspection years later, so the reader is strict
 * about the two columns that matter and forgiving about everything else. An
 * unreadable quantity is an error. A missing received date is not, because
 * plenty of older rows do not have one and refusing to load them would mean a
 * crew cannot check a show against the stock they actually hold.
 */

export interface ParsedMagazine {
  readonly magazine: Magazine;
  readonly diagnostics: DiagnosticBag;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseMagazine(text: string, source: string): ParsedMagazine {
  const diagnostics = new DiagnosticBag();
  const magazine = new Magazine();
  const table = readTable(text);

  if (table.headers.length === 0) {
    diagnostics.error({
      code: "PF1300",
      message: `${source} has no header row`,
      help: "the columns are lot, effect and quantity, then received and note",
    });
    return { magazine, diagnostics };
  }
  for (const required of ["lot", "effect", "quantity"]) {
    if (!table.headers.includes(required)) {
      diagnostics.error({
        code: "PF1301",
        message: `${source} has no ${required} column`,
      });
    }
  }
  if (diagnostics.hasErrors()) {
    return { magazine, diagnostics };
  }

  for (const record of table.records) {
    const where = `${source} line ${record.line}`;
    const lotNumber = (record.values.get("lot") ?? "").trim().toLowerCase();
    const effectId = (record.values.get("effect") ?? "").trim();
    const quantityText = (record.values.get("quantity") ?? "").trim();

    if (lotNumber.length === 0) {
      diagnostics.error({
        code: "PF1302",
        message: `${where} has no lot number`,
        help: "a lot number is what a recall pulls, so a row without one is unusable",
      });
      continue;
    }
    const problem = checkId(effectId);
    if (problem) {
      diagnostics.error({
        code: "PF1303",
        message: `${where} names an unusable effect, ${problem.detail}`,
      });
      continue;
    }
    const quantity = Number(quantityText);
    if (
      quantityText.length === 0 ||
      !Number.isInteger(quantity) ||
      quantity < 0
    ) {
      diagnostics.error({
        code: "PF1304",
        message: `${where} has a quantity of ${quantityText || "(blank)"}`,
      });
      continue;
    }

    const received = (record.values.get("received") ?? "").trim();
    if (received.length > 0 && !ISO_DATE.test(received)) {
      diagnostics.warning({
        code: "PF1305",
        message: `${where} has a received date of ${received}`,
        help: "write dates as 2025-06-14 so they sort",
      });
    }
    const note = (record.values.get("note") ?? "").trim();
    const lot: Lot = {
      lotNumber,
      effectId,
      quantity,
      ...(ISO_DATE.test(received) ? { received } : {}),
      ...(note.length > 0 ? { note } : {}),
    };
    magazine.receive(lot);
  }
  return { magazine, diagnostics };
}

/** Write the magazine back out, for a book that has been edited in place. */
export function writeMagazine(magazine: Magazine): string {
  const rows: string[][] = [["lot", "effect", "quantity", "received", "note"]];
  for (const line of magazine.stock()) {
    for (const lot of line.lots) {
      rows.push([
        lot.lotNumber,
        lot.effectId,
        String(lot.quantity),
        lot.received ?? "",
        lot.note ?? "",
      ]);
    }
  }
  return rows.map((row) => row.join(",")).join("\n");
}
