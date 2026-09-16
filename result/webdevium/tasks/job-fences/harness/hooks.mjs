// Resolution for a repository that is normally bundled: TypeScript sources by
// extensionless specifier, the "@/" root alias from tsconfig, and the vitest
// entry point, which this run answers with the local stand-in.
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP = process.env.HARNESS_APP || '/app'
const SHIM = process.env.HARNESS_SHIM || '/verify/shim.mjs'
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

export async function resolve(specifier, context, next) {
  if (specifier === 'vitest' || specifier === 'vitest/config') {
    return { url: pathToFileURL(SHIM).href, shortCircuit: true }
  }

  let target = null
  if (specifier.startsWith('@/')) {
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
