// Resolution for a repository that is normally bundled: TypeScript sources by
// extensionless specifier, the "@/" and "@lib/" aliases from tsconfig, and the
// test framework entry point, which this run answers with the local stand-in.
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let APP = '/app'
let SHIM = '/verify/shim.mjs'
let ANCHOR = ''
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
    if (typeof data.anchor === 'string' && data.anchor) {
      // A parent has to be a URL, not a path: the resolver reads the package
      // scope off it and throws Invalid URL on anything else.
      ANCHOR = data.anchor.startsWith('file:') ? data.anchor : pathToFileURL(data.anchor).href
    }
  }
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

  // A package name resolves from a tree the submission cannot reach. /app has
  // its own copy of the same packages, and a patch may add files anywhere
  // under it, so uuid or firebase-admin loaded from there would be whatever
  // the submission last wrote. The anchor points at the root-owned copy; where
  // there is none, resolution falls through unchanged rather than refusing.
  if (ANCHOR && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:')) {
    try {
      return await next(specifier, { ...context, parentURL: ANCHOR })
    } catch (error) {
      /* not in the pinned tree: let the default resolver answer */
    }
  }

  return next(specifier, context)
}
