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
import { closeSync, readFileSync, writeSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { claim, expect, titleOf } from './shim.mjs'

const emit = writeSync
const read = readFileSync
const close = closeSync
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

// The token is read once and the descriptor is shut behind it. It arrives on a
// file the graded child cannot open for itself, so leaving fd 0 open would let
// repository code read the same bytes back at offset zero and sign its own
// verdicts.
let token = ''
try {
  token = asString(read(0, 'utf8')).trim()
} catch (error) {
  token = ''
}
try {
  close(0)
} catch (error) {
  // already gone
}
if (!token) {
  emit(2, 'no run token on stdin\n')
  process.exit(3)
}

let reported = 0

// The nodes a case sits under, outermost first, which is the order hooks run
// in on the way down and the reverse of the order they run in on the way up.
function ancestry(suite) {
  const chain = []
  let cursor = suite
  while (cursor) {
    apply(Array.prototype.push, chain, [cursor])
    cursor = cursor.parent
  }
  const ordered = []
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    apply(Array.prototype.push, ordered, [chain[index]])
  }
  return ordered
}

// Run one hook list over a chain. Returns a message on the first throw.
async function runHooks(chain, name, upward) {
  for (let step = 0; step < chain.length; step += 1) {
    const index = upward ? chain.length - 1 - step : step
    const list = chain[index][name]
    if (!list) continue
    for (let h = 0; h < list.length; h += 1) {
      try {
        await list[h]()
      } catch (error) {
        return `${name} :: ${asString(error && error.message ? error.message : error)}`
      }
    }
  }
  return ''
}

// Run the once-per-suite hooks the first time a case under a node is reached.
async function openOnce(suite, opened, file, title) {
  const chain = ancestry(suite)
  for (let index = 0; index < chain.length; index += 1) {
    const node = chain[index]
    let seen = false
    for (let o = 0; o < opened.length; o += 1) {
      if (opened[o] === node) seen = true
    }
    if (seen) continue
    apply(Array.prototype.push, opened, [node])
    const list = node.before
    if (!list) continue
    for (let h = 0; h < list.length; h += 1) {
      try {
        await list[h]()
      } catch (error) {
        note(`[hook] ${file} > ${title} :: ${asString(error && error.message ? error.message : error)}`)
        return true
      }
    }
  }
  return false
}

// Run the closing hooks of every node a case was reached under.
async function closeAll(opened, file) {
  for (let index = opened.length - 1; index >= 0; index -= 1) {
    const list = opened[index].after
    if (!list) continue
    for (let h = 0; h < list.length; h += 1) {
      try {
        await list[h]()
      } catch (error) {
        note(`[hook] ${file} :: ${asString(error && error.message ? error.message : error)}`)
      }
    }
  }
}

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
  const opened = []
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
      const failure = await openOnce(suite, opened, file, title)
      if (failure) {
        say('fail', file, title)
        continue
      }
      control.arm()
      let broke = await runHooks(ancestry(suite), 'beforeEach', false)
      if (!broke) {
        try {
          await entry.fn({ expect })
        } catch (error) {
          broke = asString(error && error.message ? error.message : error)
        }
      }
      const after = await runHooks(ancestry(suite), 'afterEach', true)
      if (broke || after) {
        note(`[fail] ${file} > ${title} :: ${broke || after}`)
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
  await closeAll(opened, file)
}

emit(1, `END ${token} ${reported}\n`)
