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
const push = (list, value) => apply(Array.prototype.push, list, [value])
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

async function runAll(list) {
  for (let index = 0; index < list.length; index += 1) {
    await list[index]()
  }
}

async function runReversed(list) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    await list[index]()
  }
}

/** file hooks first, then every enclosing block from the outside in */
function chainOf(suite, kind, fileHooks) {
  const chain = []
  const blocks = []
  let cursor = suite
  while (cursor) {
    push(blocks, cursor)
    cursor = cursor.parent
  }
  const own = fileHooks[kind]
  for (let index = 0; index < own.length; index += 1) push(chain, own[index])
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const hooks = blocks[index].hooks ? blocks[index].hooks[kind] : null
    if (!hooks) continue
    for (let inner = 0; inner < hooks.length; inner += 1) push(chain, hooks[inner])
  }
  return chain
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
  const drained = control.drain()
  const collected = drained.suites
  const fileHooks = drained.hooks
  const opened = new Set()
  const closing = []
  let broken = false

  try {
    await runAll(fileHooks.beforeAll)
  } catch (error) {
    note(`[beforeAll] ${file} :: ${asString(error && error.message ? error.message : error)}`)
    broken = true
  }

  for (let s = 0; s < collected.length && !broken; s += 1) {
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
      if (!opened.has(suite)) {
        opened.add(suite)
        push(closing, suite)
        try {
          await runAll(chainOf(suite, 'beforeAll', { beforeAll: [] }))
        } catch (error) {
          note(`[beforeAll] ${file} > ${title} :: ${asString(error && error.message ? error.message : error)}`)
        }
      }
      let failed = false
      try {
        await runAll(chainOf(suite, 'beforeEach', fileHooks))
      } catch (error) {
        note(`[beforeEach] ${file} > ${title} :: ${asString(error && error.message ? error.message : error)}`)
        say('fail', file, title)
        failed = true
      }
      if (failed) continue
      control.arm()
      let counted = 0
      try {
        await entry.fn({ expect })
        counted = control.counted()
      } catch (error) {
        note(`[fail] ${file} > ${title} :: ${asString(error && error.message ? error.message : error)}`)
        failed = true
      }
      try {
        await runReversed(chainOf(suite, 'afterEach', fileHooks))
      } catch (error) {
        note(`[afterEach] ${file} > ${title} :: ${asString(error && error.message ? error.message : error)}`)
        failed = true
      }
      if (failed) {
        say('fail', file, title)
        continue
      }
      if (counted === 0) {
        note(`[empty] ${file} > ${title} :: the case asserted nothing`)
        say('fail', file, title)
        continue
      }
      say('pass', file, title)
    }
  }

  for (let index = closing.length - 1; index >= 0; index -= 1) {
    try {
      await runReversed(closing[index].hooks ? closing[index].hooks.afterAll : [])
    } catch (error) {
      note(`[afterAll] ${file} :: ${asString(error && error.message ? error.message : error)}`)
    }
  }
  try {
    await runReversed(fileHooks.afterAll)
  } catch (error) {
    note(`[afterAll] ${file} :: ${asString(error && error.message ? error.message : error)}`)
  }
}

emit(1, `END ${token} ${reported}\n`)
