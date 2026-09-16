import { compile } from "../src/compile.js";
import { firingTableCsv } from "../src/export/firingTable.js";
import { cueSheet } from "../src/export/sheets.js";
import { chainCandidates } from "../src/timeline/chain.js";
import { densityReport } from "../src/timeline/density.js";
import { generateShow } from "./generate.js";

/**
 * How long the pipeline takes on a show far larger than anybody writes.
 *
 * The interesting number is not the total, it is which stage dominates. Run it
 * with `npm run bench` after a change that touches the compiler and compare
 * the shape rather than the absolute figures, which move with the machine.
 */

interface Timing {
  readonly name: string;
  readonly ms: number;
}

function time(name: string, run: () => void): Timing {
  const started = performance.now();
  run();
  return { name, ms: performance.now() - started };
}

function main(): void {
  const sizes = [500, 2000, 8000];
  for (const size of sizes) {
    const show = generateShow({ shots: size });
    const timings: Timing[] = [];

    let compiled = compile(show.script, "bench.pf", {
      catalog: show.catalog,
      rig: show.rig,
    });
    timings.push(
      time("compile", () => {
        compiled = compile(show.script, "bench.pf", {
          catalog: show.catalog,
          rig: show.rig,
        });
      }),
    );
    timings.push(
      time("firing table", () => {
        firingTableCsv(compiled.schedule);
      }),
    );
    timings.push(
      time("cue sheet", () => {
        cueSheet(compiled.schedule);
      }),
    );
    timings.push(
      time("density", () => {
        densityReport(compiled.schedule);
      }),
    );
    timings.push(
      time("chains", () => {
        chainCandidates(compiled.schedule);
      }),
    );

    const cues = compiled.schedule.events.length;
    const total = timings.reduce((sum, entry) => sum + entry.ms, 0);
    console.log(`\n${cues} cues, ${total.toFixed(1)}ms total`);
    for (const entry of timings) {
      const share = ((entry.ms / total) * 100).toFixed(0);
      console.log(
        `  ${entry.name.padEnd(14)} ${entry.ms.toFixed(1).padStart(8)}ms  ${share.padStart(3)}%`,
      );
    }
  }
}

main();
