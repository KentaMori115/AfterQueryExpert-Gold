import { vitestConfig } from "./vitest.shared.js";

export default vitestConfig(["ecosystem-lab/cli/**/*.cli.test.ts", "packages/**/*.cli.test.ts"]);
