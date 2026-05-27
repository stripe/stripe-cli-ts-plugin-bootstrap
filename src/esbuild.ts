import type { BuildOptions } from 'esbuild'

/**
 * Base esbuild configuration shared across all Stripe CLI plugins.
 *
 * @param entryPoints - Entry points for the bundle (e.g., ['src/main.ts'])
 * @param outfile - Output file path (e.g., 'dist/bundle.js')
 * @param external - Optional array of external modules to exclude from bundle
 * @returns Complete esbuild BuildOptions
 * @public
 */
export function getPluginEsbuildConfig(
  entryPoints: string[],
  outfile: string,
  external?: string[],
): BuildOptions {
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    entryPoints,
    outfile,
    external,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    banner: {
      js: [
        'import { fileURLToPath as __esm_fileURLToPath } from "node:url";',
        'import { dirname as __esm_dirname } from "node:path";',
        'import { createRequire as __esm_createRequire } from "node:module";',
        'const __filename = __esm_fileURLToPath(import.meta.url);',
        'const __dirname = __esm_dirname(__filename);',
        'const require = __esm_createRequire(import.meta.url);',
      ].join('\n'),
    },

    // Minification (disable for easier debugging)
    minify: false,

    // Source maps
    sourcemap: isProduction ? false : 'inline',

    // Keep names for better stack traces
    keepNames: true,

    // Logging
    logLevel: 'info',
  }
}
