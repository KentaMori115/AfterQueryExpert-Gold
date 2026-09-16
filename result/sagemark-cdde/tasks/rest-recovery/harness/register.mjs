// Installs the resolver on the loader thread and hands it its two paths
// directly, so nothing it needs has to survive in the environment once the
// runner starts loading repository code.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(pathToFileURL(process.env.HARNESS_HOOKS || '/verify/hooks.mjs'), {
  data: {
    app: process.env.HARNESS_APP || '/app',
    shim: process.env.HARNESS_SHIM || '/verify/shim.mjs',
  },
})
