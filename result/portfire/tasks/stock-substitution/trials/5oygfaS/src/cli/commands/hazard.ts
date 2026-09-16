import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import {
  checkStore,
  hazardTotals,
  heaviestItems,
  transportLines,
} from "../../catalog/hazard.js";
import type { HazardDivision } from "../../catalog/hazard.js";
import { countBy } from "../../core/collect.js";
import { formatBag } from "../../core/diagnostic.js";
import { countTable } from "../../core/text.js";

const ALL_DIVISIONS: readonly HazardDivision[] = [
  "1.1G",
  "1.2G",
  "1.3G",
  "1.4G",
  "1.4S",
];

/**
 * The transport and storage numbers.
 *
 * The net explosive quantity is the figure that governs the store, the vehicle
 * and the licence, and it is the one figure nobody can measure on the day. It
 * is worth having the same estimate come out of the same place every time,
 * even though it is an estimate, because two different estimates on two
 * different forms is what gets an application refused.
 */
export const hazardCommand: Command = {
  name: "hazard",
  summary: "net explosive quantity and hazard divisions for a show",
  usage: "hazard <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    {
      name: "store",
      kind: "value",
      help: "store capacity in kilograms, to check against",
    },
    {
      name: "divisions",
      kind: "value",
      help: "divisions the licence covers, comma separated",
    },
    {
      name: "top",
      kind: "value",
      help: "how many heavy items to list",
      fallback: "5",
    },
  ],
  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (outcome.result.diagnostics.hasErrors()) {
      env.err(formatBag(outcome.result.diagnostics));
    }

    const counts = countBy(
      outcome.result.schedule.events,
      (event) => event.effectId,
    );
    const effects = new Map(
      outcome.result.schedule.events.map((event) => [
        event.effectId,
        event.effect,
      ]),
    );
    const totals = hazardTotals([...effects.values()], counts);

    env.out(
      `net explosive quantity ${(totals.totalGrams / 1000).toFixed(2)}kg`,
    );
    env.out(`most restrictive division ${totals.worst ?? "none"}`);
    env.out("");
    for (const line of transportLines(totals)) {
      env.out(line);
    }

    const topCheck = requireNumber(args, "top", { min: 0, integer: true });
    if (!topCheck.ok) {
      env.err(topCheck.reason);
      return EXIT_BAD_USAGE;
    }
    const top = topCheck.value;
    if (top > 0) {
      env.out("");
      env.out(
        countTable(
          heaviestItems([...effects.values()], counts, top).map(
            (item) => [item.effectId, item.grams] as const,
          ),
          ["effect", "net grams"],
        ),
      );
    }

    const capacity = args.values.get("store");
    if (capacity === undefined) {
      return outcomeCode(outcome);
    }
    const capacityKg = Number(capacity);
    if (!(capacityKg > 0)) {
      env.err("--store takes a capacity in kilograms above zero");
      return EXIT_BAD_USAGE;
    }
    const named = args.values.get("divisions");
    const divisions =
      named === undefined
        ? ALL_DIVISIONS
        : named
            .split(",")
            .map((part) => part.trim())
            .filter((part): part is HazardDivision =>
              (ALL_DIVISIONS as readonly string[]).includes(part),
            );
    if (divisions.length === 0) {
      env.err(`--divisions takes some of ${ALL_DIVISIONS.join(", ")}`);
      return EXIT_BAD_USAGE;
    }

    const diagnostics = checkStore(totals, { capacityKg, divisions });
    if (diagnostics.size > 0) {
      env.out("");
      env.err(formatBag(diagnostics));
    }
    return diagnostics.hasErrors() ? EXIT_SHOW_PROBLEM : outcomeCode(outcome);
  },
};
