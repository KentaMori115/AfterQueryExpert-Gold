/**
 * Colliery winding arithmetic.
 *
 * The rope that has to lift itself before it lifts anything, the drum
 * it coils on, the cycle it works to, and the depth at which all three
 * run out.
 *
 * Each namespace is one part of the installation, in the order the load
 * travels: the units it is all written in, the rope, the shaft it hangs
 * in, the air that has to get past it, the drum or wheel that drives
 * it, the conveyance on the end of it, the cycle it works to, the
 * engine that does the work, the gear that stops it going wrong, the
 * whole installation, the design it is signed off against, what it
 * costs, the colliery above it, and the report it is written up in.
 */

export * as units from "./units/index.ts";
export * as rope from "./rope/index.ts";
export * as shaft from "./shaft/index.ts";
export * as air from "./air/index.ts";
export * as drum from "./drum/index.ts";
export * as cage from "./cage/index.ts";
export * as cycle from "./cycle/index.ts";
export * as power from "./power/index.ts";
export * as safety from "./safety/index.ts";
export * as winder from "./winder/index.ts";
export * as design from "./design/index.ts";
export * as costing from "./costing/index.ts";
export * as works from "./works/index.ts";
export * as report from "./report/index.ts";
export * as cli from "./cli/index.ts";
export * from "./errors.ts";
export * from "./version.ts";
