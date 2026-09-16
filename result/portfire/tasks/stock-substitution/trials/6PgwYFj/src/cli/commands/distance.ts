import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK } from "../command.js";
import {
  calibre,
  parseCalibre,
  standardCalibres,
} from "../../catalog/calibre.js";
import { apogeeFor, leadTimeFor, riseTimeFor } from "../../catalog/lift.js";
import { renderTable } from "../../core/text.js";
import { metres, mm, raw, toFeet } from "../../core/units.js";
import type { DistanceRule } from "../../safety/distance.js";
import {
  largestCalibreFor,
  needsJustification,
  separationFor,
} from "../../safety/distance.js";

/**
 * The table a crew pins inside the van door.
 *
 * It needs no script, no rig and no catalog, because the question it answers
 * comes up while standing in a field with a tape measure and a phone. Given a
 * field, what can we shoot. Given a shell, how far back does the line go.
 */
export const distanceCommand: Command = {
  name: "distance",
  summary: "separation distances and flight times by calibre",
  usage: "distance [calibre] [options]",
  flags: [
    {
      name: "rule",
      kind: "value",
      help: "separation rule",
      choices: ["nfpa-1123", "cen-category-4", "reduced"],
      fallback: "nfpa-1123",
    },
    {
      name: "available",
      kind: "value",
      help: "metres of room, to ask what fits",
    },
    { name: "feet", kind: "switch", help: "print distances in feet as well" },
  ],
  run(args, env) {
    const rule = (args.values.get("rule") ?? "nfpa-1123") as DistanceRule;

    if (args.values.get("available") !== undefined) {
      const check = requireNumber(args, "available", { min: 0 });
      if (!check.ok) {
        env.err(check.reason);
        return EXIT_BAD_USAGE;
      }
      const room = check.value;
      const largest = largestCalibreFor(metres(room), rule);
      env.out(
        largest === 0
          ? `${room}m is not enough room for anything under ${rule}`
          : `${room}m takes up to ${largest}mm under ${rule}`,
      );
      return EXIT_OK;
    }

    const wanted = args.positional[0];
    const sizes =
      wanted === undefined
        ? standardCalibres()
        : (() => {
            const parsed = parseCalibre(wanted);
            return parsed === undefined ? undefined : [parsed];
          })();
    if (sizes === undefined) {
      env.err(`${wanted ?? ""} is not a calibre, write it as 150mm or 6in`);
      return EXIT_BAD_USAGE;
    }

    const showFeet = args.switches.has("feet");
    const rows = sizes.map((size) => {
      const separation = separationFor(size, rule);
      const row = [
        `${raw(size.size).toFixed(0)}mm`,
        `${size.inchLabel}in`,
        `${raw(apogeeFor(size)).toFixed(0)}m`,
        `${(raw(riseTimeFor(size)) / 1000).toFixed(2)}s`,
        `${(raw(leadTimeFor(size)) / 1000).toFixed(2)}s`,
        `${raw(separation).toFixed(0)}m`,
      ];
      if (showFeet) {
        row.push(`${toFeet(separation).toFixed(0)}ft`);
      }
      row.push(needsJustification(size) ? "justify" : "");
      return row;
    });

    const columns = [
      { header: "bore" },
      { header: "calibre" },
      { header: "apogee", align: "right" as const },
      { header: "rise", align: "right" as const },
      { header: "lead", align: "right" as const },
      { header: "separation", align: "right" as const },
      ...(showFeet ? [{ header: "in feet", align: "right" as const }] : []),
      { header: "note" },
    ];
    env.out(renderTable(columns, rows));
    return EXIT_OK;
  },
};

/** The bore a crew would pick for a field, for a caller other than the CLI. */
export function pickCalibre(
  availableMetres: number,
  rule: DistanceRule = "nfpa-1123",
): ReturnType<typeof calibre> | undefined {
  const largest = largestCalibreFor(metres(availableMetres), rule);
  return largest === 0 ? undefined : calibre(mm(largest));
}
