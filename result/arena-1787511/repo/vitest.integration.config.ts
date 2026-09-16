import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    sequence: { shuffle: false },
    fileParallelism: false,
    pool: "forks",
    isolate: true,
  },
});
