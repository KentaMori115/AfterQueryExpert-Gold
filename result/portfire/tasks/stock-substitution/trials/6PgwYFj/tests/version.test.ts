import { describe, expect, it } from "vitest";
import {
  MINIMUM_NODE,
  SCHEMA_VERSION,
  VERSION,
  compareVersions,
  describeVersion,
  nodeIsSupported,
  versionInfo,
} from "../src/version.js";
import { SHOW_JSON_VERSION } from "../src/export/json.js";
import { EXIT_OK } from "../src/cli/command.js";
import { MemoryEnv } from "../src/cli/env.js";
import { EXIT_INTERNAL, main, runMain } from "../src/cli/main.js";

describe("the constants", () => {
  it("looks like a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("agrees with the show json version", () => {
    expect(SCHEMA_VERSION).toBe(SHOW_JSON_VERSION);
  });

  it("names a node floor that matches the package", () => {
    expect(MINIMUM_NODE).toMatch(/^\d+\.\d+$/);
  });
});

describe("versionInfo", () => {
  it("reports the running node and platform", () => {
    const info = versionInfo();
    expect(info.version).toBe(VERSION);
    expect(info.node).not.toBe("unknown");
    expect(info.platform.length).toBeGreaterThan(0);
  });

  it("describes itself over three lines", () => {
    expect(describeVersion().split("\n")).toHaveLength(3);
    expect(describeVersion()).toContain("portfire");
    expect(describeVersion()).toContain("show schema");
  });

  it("describes an info it was handed", () => {
    const text = describeVersion({
      version: "9.9.9",
      schema: 4,
      node: "20.11.0",
      platform: "linux",
    });
    expect(text).toContain("portfire 9.9.9");
    expect(text).toContain("show schema 4");
  });
});

describe("compareVersions", () => {
  it("orders by each part in turn", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("says equal versions are equal", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("treats a missing part as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.1")).toBeLessThan(0);
  });

  it("falls back to text for something that is not a version", () => {
    expect(compareVersions("next", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("next", "next")).toBe(0);
  });
});

describe("nodeIsSupported", () => {
  it("accepts the floor and anything above it", () => {
    expect(nodeIsSupported("20.11.0")).toBe(true);
    expect(nodeIsSupported("22.4.1")).toBe(true);
  });

  it("rejects anything below it", () => {
    expect(nodeIsSupported("18.19.0")).toBe(false);
    expect(nodeIsSupported("20.10.9")).toBe(false);
  });

  it("accepts the node this is running on", () => {
    expect(nodeIsSupported(process.versions.node)).toBe(true);
  });
});

describe("the version command", () => {
  it("prints the whole block", () => {
    const env = new MemoryEnv();
    expect(main(["version"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("portfire");
    expect(env.stdout).toContain("node");
  });

  it("prints the version alone when asked", () => {
    const env = new MemoryEnv();
    main(["version", "--short"], env);
    expect(env.stdout).toBe(VERSION);
  });

  it("says nothing on standard error on a supported node", () => {
    const env = new MemoryEnv();
    main(["version"], env);
    expect(env.stderr).toBe("");
  });
});

describe("the version flag", () => {
  it("works before any command", () => {
    const env = new MemoryEnv();
    expect(main(["--version"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("portfire");
  });

  it("takes the short form too", () => {
    const env = new MemoryEnv();
    expect(main(["-v"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("show schema");
  });

  it("does not shadow a command called with it later", () => {
    const env = new MemoryEnv();
    main(["version", "--short"], env);
    expect(env.stdout).toBe(VERSION);
  });

  it("still refuses an unknown short flag inside a command", () => {
    const env = new MemoryEnv();
    expect(main(["distance", "-v"], env)).not.toBe(EXIT_OK);
  });
});

describe("runMain", () => {
  class Exploding extends MemoryEnv {
    override readFile(): string | undefined {
      throw new Error("the disk caught fire");
    }
  }

  it("passes an ordinary run straight through", () => {
    const env = new MemoryEnv();
    expect(runMain(["version", "--short"], env)).toBe(EXIT_OK);
    expect(env.stdout).toBe(VERSION);
  });

  it("turns a throw into an internal error code", () => {
    const env = new Exploding({ "s.pf": "at 1 fire a from b" });
    expect(runMain(["lint", "s.pf"], env)).toBe(EXIT_INTERNAL);
  });

  it("says what happened and that it is a bug", () => {
    const env = new Exploding({ "s.pf": "at 1 fire a from b" });
    runMain(["lint", "s.pf"], env);
    expect(env.stderr).toContain("the disk caught fire");
    expect(env.stderr).toContain("this is a bug");
    expect(env.stderr).toContain(VERSION);
  });

  it("keeps the internal code apart from a show problem", () => {
    expect(EXIT_INTERNAL).not.toBe(EXIT_OK);
    expect(EXIT_INTERNAL).toBeGreaterThan(2);
  });

  it("describes something thrown that is not an Error", () => {
    class OddThrow extends MemoryEnv {
      override readFile(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { code: 42 };
      }
    }
    const env = new OddThrow();
    expect(runMain(["lint", "s.pf"], env)).toBe(EXIT_INTERNAL);
    expect(env.stderr).toContain('"code":42');
  });
});
