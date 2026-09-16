// Resolution and compilation for a repository that is normally bundled:
// TypeScript sources by extensionless specifier, the "@/" and "@lib/" aliases
// the repository maps, and the test framework entry point, which this run
// answers with the local stand-in.
//
// TypeScript itself compiles the sources, the way the repository's own runner
// does. Node can strip types on its own, but stripping is not compiling: it
// rejects `import { SomeInterface }` where the compiler would simply drop the
// binding, and a submission that imports one of its own types that way is
// correct TypeScript failed by the runner rather than by its own work.
//
// The compiler is taken from outside the checkout. Whatever a submission adds
// to its own package tree has no say in how its sources are read.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let APP = '/app'
let SHIM = '/verify/shim.mjs'
const TYPESCRIPT = ['/opt/task-node_modules/typescript', '/usr/lib/node_modules/typescript']
const SOURCE = /\.(ts|tsx|mts|cts)$/
let compiler = null
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']

function fileAt(base) {
  try {
    if (existsSync(base) && statSync(base).isFile()) return base
  } catch (error) {
    return null
  }
  for (const extension of EXTENSIONS) {
    if (existsSync(base + extension)) return base + extension
  }
  for (const extension of EXTENSIONS) {
    const candidate = join(base, 'index' + extension)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The registrar hands the two paths over here, ahead of any resolution. */
export async function initialize(data) {
  if (data && typeof data === 'object') {
    if (typeof data.app === 'string' && data.app) APP = data.app
    if (typeof data.shim === 'string' && data.shim) SHIM = data.shim
  }
  const require = createRequire('/opt/noop.js')
  for (const candidate of TYPESCRIPT) {
    if (!existsSync(candidate)) continue
    try {
      compiler = require(candidate)
      break
    } catch (error) {
      compiler = null
    }
  }
}

/**
 * Compiles a source file the way the repository's runner would.
 *
 * Only files under the checkout go through here; the harness's own modules are
 * plain JavaScript and Node loads them itself. Without a compiler on the box
 * this hook stands aside and Node's own type stripping runs instead.
 */
export async function load(url, context, next) {
  if (compiler === null || !url.startsWith('file:') || !SOURCE.test(url)) {
    return next(url, context)
  }
  const path = fileURLToPath(url)
  if (!path.startsWith(APP)) {
    return next(url, context)
  }
  const compiled = compiler.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: {
      target: compiler.ScriptTarget.ES2022,
      module: compiler.ModuleKind.ESNext,
      moduleResolution: compiler.ModuleResolutionKind.Bundler,
      isolatedModules: true,
      esModuleInterop: true,
      jsx: compiler.JsxEmit.Preserve,
    },
  })
  return { format: 'module', source: compiled.outputText, shortCircuit: true }
}

export async function resolve(specifier, context, next) {
  if (specifier === '@jest/globals' || specifier === 'vitest') {
    return { url: pathToFileURL(SHIM).href, shortCircuit: true }
  }

  let target = null
  if (specifier.startsWith('@lib/')) {
    target = join(APP, 'lib', specifier.slice(5))
  } else if (specifier.startsWith('@/')) {
    target = join(APP, specifier.slice(2))
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parent =
      context.parentURL && context.parentURL.startsWith('file:')
        ? dirname(fileURLToPath(context.parentURL))
        : APP
    target = resolvePath(parent, specifier)
  }

  if (target) {
    let found = fileAt(target)
    if (!found && target.endsWith('.js')) found = fileAt(target.slice(0, -3))
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  }

  return next(specifier, context)
}
