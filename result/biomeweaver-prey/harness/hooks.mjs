// Resolution for a verifier that runs the repository's TypeScript directly:
// the vitest specifier lands on the shim, workspace names land on package
// sources, and the ".js" specifiers TypeScript writes land on the ".ts" beside
// them. Nothing here reads a configuration file out of the tree under test.
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let APP = "/app";
let SHIM = "/verify/shim.mjs";

const PACKAGES = {
  "@biomeweaver/fixed-point": "fixed-point",
  "@biomeweaver/capsule-source": "capsule-source",
  "@biomeweaver/biome-model": "biome-model",
  "@biomeweaver/calendar-engine": "calendar-engine",
  "@biomeweaver/resource-engine": "resource-engine",
  "@biomeweaver/population-engine": "population-engine",
  "@biomeweaver/predation-engine": "predation-engine",
  "@biomeweaver/tick-runtime": "tick-runtime",
  "@biomeweaver/flow-explanations": "flow-explanations",
  "@biomeweaver/run-store": "run-store",
  "@biomeweaver/biome-reports": "biome-reports",
  "@biomeweaver/cli": "biomeweaver-cli",
  biomeweaver: "biomeweaver",
};

export function initialize(data) {
  APP = data?.app ?? APP;
  SHIM = data?.shim ?? SHIM;
}

export function resolve(specifier, context, next) {
  if (specifier === "vitest") {
    return { url: pathToFileURL(SHIM).href, shortCircuit: true };
  }
  const pkg = PACKAGES[specifier];
  if (pkg) {
    return {
      url: pathToFileURL(`${APP}/packages/${pkg}/src/index.ts`).href,
      shortCircuit: true,
    };
  }
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
    const parent = dirname(fileURLToPath(context.parentURL));
    const candidate = resolvePath(parent, `${specifier.slice(0, -3)}.ts`);
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
