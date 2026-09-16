// Runs one selection of suites and reports each case on stdout under a token
// the publisher hands in. Everything the reporting path needs is captured
// before a line of repository code is imported.
import { readFileSync, writeSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, reset, suites, titleOf } from './shim.mjs'

const emit = writeSync
const read = readFileSync
const APP = process.env.HARNESS_APP || '/app'

let token = ''
try {
  token = String(read(0, 'utf8')).trim()
} catch (error) {
  token = ''
}
if (!token) {
  emit(2, 'no run token on stdin\n')
  process.exit(3)
}

const files = process.argv.slice(2)
let reported = 0

function say(status, file, title) {
  emit(1, `V ${token} ${status} ${file}\t${title}\n`)
  reported += 1
}

function note(text) {
  try {
    emit(2, text + '\n')
  } catch (error) {
    /* the log is best effort */
  }
}

for (const file of files) {
  reset()
  const absolute = resolvePath(APP, file)
  try {
    await import(pathToFileURL(absolute).href)
  } catch (error) {
    note(`[load] ${file} :: ${String(error && error.stack ? error.stack : error)}`)
    continue
  }
  const collected = suites.slice()
  for (const suite of collected) {
    for (const entry of suite.tests) {
      const title = titleOf(suite, entry)
      try {
        await entry.fn({ expect })
        say('pass', file, title)
      } catch (error) {
        note(`[fail] ${file} > ${title} :: ${String(error && error.message ? error.message : error)}`)
        say('fail', file, title)
      }
    }
  }
}

emit(1, `END ${token} ${reported}\n`)
