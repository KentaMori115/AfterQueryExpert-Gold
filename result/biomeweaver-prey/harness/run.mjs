// Run the cases in the files named on the command line and write one JUnit
// report. Ids are "<path relative to the app>.<describe chain> > <case>", the
// same shape the project runner reports.
import { register } from "node:module";
import { closeSync, readSync, writeSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = process.env["HARNESS_APP"] ?? "/app";
const SHIM = process.env["HARNESS_SHIM"] ?? "/verify/shim.mjs";
const HOOKS = process.env["HARNESS_HOOKS"] ?? "/verify/hooks.mjs";

// The run token arrives as an already open standard input and the descriptor
// is shut behind it, before a single module of the repository loads. It never
// reaches a command line: /proc/<pid>/cmdline is world readable, and the point
// of the token is to be unavailable to the code being graded.
const write = writeSync;
let token = "";
try {
  const buffer = Buffer.alloc(4096);
  const read = readSync(0, buffer, 0, buffer.length, null);
  token = buffer.subarray(0, read).toString("utf8").trim();
} catch {
  token = "";
}
try {
  closeSync(0);
} catch {
  /* a closed descriptor is what was wanted anyway */
}

register(pathToFileURL(HOOKS), { data: { app: APP, shim: SHIM } });

const shim = await import(pathToFileURL(SHIM).href);

function clean(value) {
  return String(value).replace(/[\u0000-\u001f]/g, " ");
}

function say(status, classname, name) {
  write(1, `V ${token} ${status} ${clean(classname)}\t${clean(name)}\n`);
  reported += 1;
}

let reported = 0;
let failures = 0;

for (const argument of process.argv.slice(2)) {
  const file = resolve(APP, argument);
  const classname = relative(APP, file);
  let cases = [];
  try {
    await import(pathToFileURL(file).href);
    cases = shim.drain();
  } catch (error) {
    shim.drain();
    failures += 1;
    write(2, `[harness] ${classname} did not load: ${error}\n`);
    continue;
  }
  for (const item of cases) {
    const name = [...item.path, item.title].join(" > ");
    try {
      const outcome = item.body();
      if (outcome && typeof outcome.then === "function") {
        await outcome;
      }
      say("pass", classname, name);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      write(2, `[harness] ${classname} ${name}: ${message}\n`);
      say("fail", classname, name);
    }
  }
}

write(1, `END ${token} ${reported}\n`);
process.exit(failures === 0 ? 0 : 1);
