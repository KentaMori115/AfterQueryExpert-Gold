import { describe, expect, it } from "vitest";
import {
  bashCompletion,
  completionFor,
  zshCompletion,
} from "../../src/cli/completion.js";
import { EXIT_BAD_USAGE, EXIT_OK } from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";
import { buildCommands } from "../../src/cli/registry.js";

const commands = buildCommands();

describe("bash completion", () => {
  const script = bashCompletion(commands);

  it("registers the function against the binary", () => {
    expect(script).toContain("complete -F _portfire portfire");
  });

  it("offers every command at the first word", () => {
    for (const name of commands.names()) {
      expect(script).toContain(name);
    }
  });

  it("offers each command's own flags", () => {
    expect(script).toContain("--catalog");
    expect(script).toContain("--audience");
    expect(script).toContain("--walk");
  });

  it("falls back to filenames for a positional", () => {
    expect(script).toContain("compgen -f");
  });

  it("says how to install itself", () => {
    expect(script).toContain("eval");
  });
});

describe("zsh completion", () => {
  const script = zshCompletion(commands);

  it("starts with the compdef line", () => {
    expect(script.startsWith("#compdef portfire")).toBe(true);
  });

  it("describes every command", () => {
    for (const command of commands.all()) {
      expect(script).toContain(`${command.name}:`);
    }
  });

  it("describes the flags with their help text", () => {
    expect(script).toContain("--catalog[the effect catalog csv]");
  });

  it("escapes a quote in help text rather than breaking the script", () => {
    // The continuity command's --walk help says "the panel's dump", and an
    // unescaped apostrophe there would close the single quoted spec.
    const escape = String.fromCharCode(39, 92, 39, 39);
    expect(script).toContain(`panel${escape}s continuity dump`);
    expect(script).not.toContain("[the panel's continuity dump]");
  });
});

describe("completionFor", () => {
  it("picks the shell it was asked for", () => {
    expect(completionFor(commands, "zsh").startsWith("#compdef")).toBe(true);
    expect(completionFor(commands, "bash")).toContain("complete -F");
  });
});

describe("the completion command", () => {
  it("writes a bash script by default", () => {
    const env = new MemoryEnv();
    expect(main(["completion"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("complete -F _portfire");
  });

  it("writes a zsh script on request", () => {
    const env = new MemoryEnv();
    main(["completion", "--shell", "zsh"], env);
    expect(env.stdout).toContain("#compdef portfire");
  });

  it("refuses a shell it does not write for", () => {
    const env = new MemoryEnv();
    expect(main(["completion", "--shell", "fish"], env)).toBe(EXIT_BAD_USAGE);
  });

  it("keeps up with a command being added", () => {
    const env = new MemoryEnv();
    main(["completion"], env);
    for (const name of buildCommands().names()) {
      expect(env.stdout).toContain(name);
    }
  });
});
