// Runs one selection of suites and reports each case on stdout under a token
// the publisher hands in.
//
// Verdict generation is kept out of the repository's reach rather than merely
// ahead of it. The builtins this file writes and resolves with are captured
// here, at the top; the shim's control surface is claimed on the same line and
// is gone before any dynamic import runs, so a submission that finds either
// file on disk cannot reach the case list, the counter or the stream. The
// cases for a file are drained before the first of them runs, and a case that
// asserts nothing is failed rather than credited: a named no-op body has
// nothing to gain.
import { readFileSync, writeSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { claim, expect, titleOf } from './shim.mjs'

const emit = writeSync
const read = readFileSync
const apply = Reflect.apply
const asString = String
const argv = apply(Array.prototype.slice, process.argv, [2])
const APP = process.env.HARNESS_APP || '/app'

const control = claim()
if (control === null) {
  emit(2, 'the harness control surface was already claimed\n')
  process.exit(4)
}

// Nothing loaded from /app needs to know where the harness lives.
delete process.env.HARNESS_APP
delete process.env.HARNESS_SHIM
delete process.env.HARNESS_HOOKS

let token = ''
try {
  token = asString(read(0, 'utf8')).trim()
} catch (error) {
  token = ''
}
if (!token) {
  emit(2, 'no run token on stdin\n')
  process.exit(3)
}

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

for (const file of argv) {
  control.open()
  const absolute = resolvePath(APP, file)
  try {
    await import(pathToFileURL(absolute).href)
  } catch (error) {
    note(`[load] ${file} :: ${asString(error && error.stack ? error.stack : error)}`)
    continue
  }
  const collected = control.drain()
  for (let s = 0; s < collected.length; s += 1) {
    const suite = collected[s]
    const cases = suite.tests
    for (let c = 0; c < cases.length; c += 1) {
      const entry = cases[c]
      const title = titleOf(suite, entry)
      if (typeof entry.fn !== 'function') {
        note(`[shape] ${file} > ${title} :: case body is not a function`)
        say('fail', file, title)
        continue
      }
      control.arm()
      try {
        await entry.fn({ expect })
      } catch (error) {
        note(`[fail] ${file} > ${title} :: ${asString(error && error.message ? error.message : error)}`)
        say('fail', file, title)
        continue
      }
      if (control.counted() === 0) {
        note(`[empty] ${file} > ${title} :: the case asserted nothing`)
        say('fail', file, title)
        continue
      }
      say('pass', file, title)
    }
  }
}

emit(1, `END ${token} ${reported}\n`)
