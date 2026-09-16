import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function completeBiome(name: string): string {
  return join(here, "..", "complete-biomes", name);
}

export function microBiome(name: string): string {
  return join(here, "..", "micro-biomes", name);
}

export function invalidModel(name: string): string {
  return join(here, "..", "invalid-models", name);
}
