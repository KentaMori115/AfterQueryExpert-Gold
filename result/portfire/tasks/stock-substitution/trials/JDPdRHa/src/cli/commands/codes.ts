import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK } from "../command.js";
import {
  CODE_NOTES,
  CODE_RANGES,
  explainCode,
  notedCodes,
} from "../../core/codes.js";
import { renderTable } from "../../core/text.js";
import { wrap } from "../../core/text.js";

/**
 * Looking a code up.
 *
 * Somebody reads a code off a screen in a field and wants to know whether it
 * stops the show. The range alone answers that most of the time, which is why
 * the ranges are printed before anything else.
 */
export const codesCommand: Command = {
  name: "codes",
  summary: "explain a diagnostic code, or list the ranges",
  usage: "codes [code]",
  flags: [{ name: "all", kind: "switch", help: "list every noted code" }],
  run(args, env) {
    const wanted = args.positional[0];

    if (wanted !== undefined) {
      const found = explainCode(wanted);
      if (found === undefined) {
        env.err(`${wanted} is not a portfire code, they look like PF3100`);
        return EXIT_BAD_USAGE;
      }
      env.out(`${found.code}, ${found.area}`);
      env.out("");
      for (const line of wrap(found.meaning, 72)) {
        env.out(line);
      }
      if (found.note !== undefined) {
        env.out("");
        for (const line of wrap(found.note, 72)) {
          env.out(line);
        }
      }
      return EXIT_OK;
    }

    if (args.switches.has("all")) {
      for (const code of notedCodes()) {
        env.out(code);
        for (const line of wrap(CODE_NOTES.get(code) ?? "", 68)) {
          env.out(`  ${line}`);
        }
        env.out("");
      }
      return EXIT_OK;
    }

    env.out(
      renderTable(
        [{ header: "range" }, { header: "area" }, { header: "meaning" }],
        CODE_RANGES.map((range) => [
          `PF${range.from} to PF${range.to}`,
          range.area,
          range.meaning,
        ]),
      ),
    );
    env.out("");
    env.out("run portfire codes PF3100 to look one up");
    return EXIT_OK;
  },
};
