import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const aliases = {
  "@biomeweaver/fixed-point": fileURLToPath(
    new URL("./packages/fixed-point/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/capsule-source": fileURLToPath(
    new URL("./packages/capsule-source/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/biome-model": fileURLToPath(
    new URL("./packages/biome-model/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/calendar-engine": fileURLToPath(
    new URL("./packages/calendar-engine/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/resource-engine": fileURLToPath(
    new URL("./packages/resource-engine/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/population-engine": fileURLToPath(
    new URL("./packages/population-engine/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/predation-engine": fileURLToPath(
    new URL("./packages/predation-engine/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/tick-runtime": fileURLToPath(
    new URL("./packages/tick-runtime/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/flow-explanations": fileURLToPath(
    new URL("./packages/flow-explanations/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/run-store": fileURLToPath(
    new URL("./packages/run-store/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/biome-reports": fileURLToPath(
    new URL("./packages/biome-reports/src/index.ts", import.meta.url),
  ),
  "@biomeweaver/cli": fileURLToPath(
    new URL("./packages/biomeweaver-cli/src/index.ts", import.meta.url),
  ),
  biomeweaver: fileURLToPath(new URL("./packages/biomeweaver/src/index.ts", import.meta.url)),
};

export function vitestConfig(include: string[], exclude: string[] = []) {
  return defineConfig({
    resolve: { alias: aliases },
    test: { include, exclude },
  });
}
