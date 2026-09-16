/**
 * `sheave audit` — what a winding engineer would say after a week here.
 *
 * The design checks say whether an installation meets its figures. This
 * says what is wrong with it, which is a different question and usually
 * the more useful one. A winder can be inside every band in the design
 * and still be badly arranged: a rope too stiff for its drum, a drum
 * too far from its sheave, or a standing time so long that the winder's
 * speed is irrelevant to the output.
 */

import { readFileSync } from "node:fs";
import type { Args } from "../args.ts";
import { flag, onlyKnown, option, word } from "../args.ts";
import { parseWinder } from "../../winder/parse.ts";
import { auditWinder, counted, errors, passes, summary } from "../../winder/audit.ts";
import { heading, many, sentence, verdict, wrapped } from "../../report/format.ts";
import { blocks, centre, indented, left, table } from "../../report/table.ts";

const KNOWN = ["only", "errors"];

/** Run it. */
export function auditCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = parseWinder(readFileSync(word(args, 0, "a winder file"), "utf8"));
  const all = flag(args, "errors") ? errors(auditWinder(one)) : auditWinder(one);
  const only = option(args, "only");
  const found = only === undefined ? all : all.filter((each) => each.part === only);
  const how = counted(auditWinder(one));

  const out: string[] = [...heading(summary(one))];
  if (found.length === 0) {
    out.push("nothing to report");
  } else {
    out.push(
      ...table(
        [centre("severity"), left("part"), left("")],
        found.map((each) => [each.severity, each.part, sentence(each.message)]),
      ),
    );
  }

  return blocks(
    out,
    [
      "",
      ...heading("in all"),
      ...indented([many(how.error, "error"), many(how.warning, "warning"), many(how.note, "note"), `passes: ${verdict(passes(one))}`]),
    ],
    wrapped(
      "An error is something that cannot be true of a working installation and therefore means a " +
        "figure on the certificate is wrong. A warning is something that can be true and should " +
        "not be. A note is a figure worth knowing, and the notes are the ones an engineer reads " +
        "first, because they say what the machine is doing rather than what is the matter with it.",
    ),
  );
}
