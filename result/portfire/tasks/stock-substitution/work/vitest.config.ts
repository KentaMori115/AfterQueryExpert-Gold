import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/bin/**", "src/index.ts"],
      reporter: ["text-summary", "lcov"],
      // The floors sit just under where the suite is, so a change that loses
      // coverage fails rather than being noticed a month later. Raise them
      // when the real figure moves up, never lower them to make a build pass.
      thresholds: {
        statements: 97,
        branches: 92,
        functions: 99,
        lines: 97,
      },
    },
  },
});
