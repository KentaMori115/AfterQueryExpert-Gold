/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>"],
    testMatch: ["**/__tests__/**/*.test.ts"],
    transform: {
        "^.+\\.ts$": [
            "ts-jest",
            {
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
        "^@/(.*)$": "<rootDir>/$1",
        "^@lib/(.*)$": "<rootDir>/lib/$1",
    },
    collectCoverageFrom: ["lib/**/*.ts"],
}