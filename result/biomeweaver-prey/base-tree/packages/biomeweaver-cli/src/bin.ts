#!/usr/bin/env node
import { runCommand } from "./router.js";

const result = runCommand(process.argv.slice(2));
if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;
