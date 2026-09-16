// Verifier-owned jest configuration. The repository's own jest.config.js,
// package.json and tsconfig.json are all committed files, so a submission can
// rewrite them; none of them is read here. Module resolution deliberately
// points at the image's package tree rather than anything under /app.
module.exports = {
    rootDir: "/app",
    testEnvironment: "node",
    testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
    transform: {
        "^.+\\.tsx?$": [
            "/opt/task-node_modules/ts-jest/dist/index.js",
            {
                // Transpile only. The graded suite must compile against
                // whatever shapes a submission chose, and a type error in one
                // file would otherwise take every case in it down with it.
                isolatedModules: true,
                diagnostics: false,
                tsconfig: {
                    target: "ES2020",
                    module: "commonjs",
                    moduleResolution: "node",
                    esModuleInterop: true,
                    isolatedModules: true,
                    skipLibCheck: true,
                },
            },
        ],
    },
    moduleNameMapper: {
        "^@/(.*)$": "/app/$1",
        "^@lib/(.*)$": "/app/lib/$1",
    },
    modulePaths: ["/opt/task-node_modules"],
    setupFilesAfterEnv: ["/verify/guard.js"],
    reporters: [["/verify/reporter.js", {}]],
    testTimeout: 20000,
    cache: false,
    verbose: false,
}
