/**
 * The public surface.
 *
 * Grouped by stage rather than alphabetically, because the order a reader
 * wants is the order a show goes through: what it is measured in, what it is
 * made of, where it is fired from, how it is written, when each cue goes, and
 * whether any of that is safe.
 *
 * Everything is exported. A tool this specific is more often reached for as a
 * library by somebody automating one part of it than used whole, and hiding
 * the middle of the pipeline would only mean that person copying it.
 */

// the primitives everything else is measured in
export * from "./core/codes.js";
export * from "./core/collect.js";
export * from "./core/csv.js";
export * from "./core/diagnostic.js";
export * from "./core/graph.js";
export * from "./core/ids.js";
export * from "./core/interval.js";
export * from "./core/numeric.js";
export * from "./core/result.js";
export * from "./core/rng.js";
export * from "./core/span.js";
export * from "./core/text.js";
export * from "./core/timecode.js";
export * from "./core/units.js";

// what a show is made of
export * from "./catalog/calibre.js";
export * from "./catalog/effect.js";
export * from "./catalog/envelope.js";
export * from "./catalog/hazard.js";
export * from "./catalog/inventory.js";
export * from "./catalog/lift.js";
export * from "./catalog/magazine.js";
export * from "./catalog/palette.js";
export * from "./catalog/parse.js";
export * from "./catalog/registry.js";
export * from "./catalog/substitute.js";
export * from "./catalog/timing.js";
export * from "./catalog/validate.js";

// the firing system and where it stands
export * from "./rig/allocate.js";
export * from "./rig/circuit.js";
export * from "./rig/continuity.js";
export * from "./rig/layout.js";
export * from "./rig/module.js";
export * from "./rig/parse.js";
export * from "./rig/pin.js";
export * from "./rig/redundancy.js";
export * from "./rig/rig.js";
export * from "./rig/wiring.js";

// the cue script, from text to resolved shots
export * from "./script/annotate.js";
export * from "./script/ast.js";
export * from "./script/expand.js";
export * from "./script/format.js";
export * from "./script/include.js";
export * from "./script/lint.js";
export * from "./script/parser.js";
export * from "./script/renumber.js";
export * from "./script/resolve.js";
export * from "./script/token.js";

// the firing table and what can be read off it
export * from "./timeline/balance.js";
export * from "./timeline/chain.js";
export * from "./timeline/density.js";
export * from "./timeline/diff.js";
export * from "./timeline/load.js";
export * from "./timeline/misfire.js";
export * from "./timeline/quantise.js";
export * from "./timeline/rehearsal.js";
export * from "./timeline/schedule.js";
export * from "./timeline/sync.js";

// the checks that decide whether it can be fired
export * from "./safety/crowd.js";
export * from "./safety/distance.js";
export * from "./safety/noise.js";
export * from "./safety/rules.js";
export * from "./safety/site.js";
export * from "./safety/wind.js";

// seeing the show without firing it
export * from "./sim/preview.js";
export * from "./sim/trajectory.js";

// everything that leaves the tool
export * from "./export/explain.js";
export * from "./export/firingTable.js";
export * from "./export/json.js";
export * from "./export/pack.js";
export * from "./export/permit.js";
export * from "./export/sheets.js";
export * from "./export/siteplan.js";

// the command line, usable as a library
export * from "./cli/args.js";
export * from "./cli/command.js";
export * from "./cli/commands/double.js";
export * from "./cli/commands/label.js";
export * from "./cli/commands/preview.js";
export * from "./cli/completion.js";
export * from "./cli/env.js";
export * from "./cli/main.js";
export * from "./cli/registry.js";

// the pipeline in one call, and the build
export * from "./compile.js";
export * from "./version.js";
