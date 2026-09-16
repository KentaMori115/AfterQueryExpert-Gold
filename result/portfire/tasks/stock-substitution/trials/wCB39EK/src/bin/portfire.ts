#!/usr/bin/env node
import { runMain } from "../cli/main.js";
import { NodeEnv } from "../cli/nodeEnv.js";

process.exitCode = runMain(process.argv.slice(2), new NodeEnv());
