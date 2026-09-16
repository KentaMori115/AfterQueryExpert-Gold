import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  "capsule-source",
  "biome-model",
  "fixed-point",
  "calendar-engine",
  "resource-engine",
  "population-engine",
  "predation-engine",
  "tick-runtime",
  "flow-explanations",
  "run-store",
  "biome-reports",
  "biomeweaver",
  "biomeweaver-cli",
];

rmSync(join(root, "dist"), { recursive: true, force: true });
for (const name of packages) {
  rmSync(join(root, "packages", name, "dist"), { recursive: true, force: true });
  rmSync(join(root, "packages", name, "tsconfig.tsbuildinfo"), { force: true });
}
