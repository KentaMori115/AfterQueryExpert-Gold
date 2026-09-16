module.exports = {
  rootDir: "/app",
  roots: ["/app/src", "/app/tests"],
  testEnvironment: "/opt/deps/node_modules/jest-environment-node",
  testMatch: ["**/*.test.ts"],
  transform: { "^.+\\.ts$": ["/opt/deps/node_modules/ts-jest", {
      isolatedModules: true, diagnostics: false,
      tsconfig: { target: "ES2022", module: "commonjs", moduleResolution: "node", esModuleInterop: true, skipLibCheck: true, types: [] } }] },
  modulePaths: ["/opt/deps/node_modules"],
  cacheDirectory: "/tmp/aq-cache",
  testTimeout: 15000,
};
