import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(pathToFileURL(process.env.HARNESS_HOOKS || '/verify/hooks.mjs'))
