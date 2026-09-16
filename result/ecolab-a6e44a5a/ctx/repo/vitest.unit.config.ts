import { vitestConfig } from "./vitest.shared.js";

export default vitestConfig(["packages/**/*.test.ts"], ["**/*.cli.test.ts"]);
