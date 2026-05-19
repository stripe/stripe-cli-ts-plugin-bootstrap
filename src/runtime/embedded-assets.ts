/**
 * Runtime helpers for accessing assets embedded in Bun-compiled binaries.
 *
 * BUNDLED CONSUMPTION ONLY — this module is designed to be imported in plugin
 * source code and then **bundled by esbuild** into the plugin's dist/bundle.js.
 * It relies on `__dirname` resolving to the plugin's own dist/ directory.
 *
 * It does NOT work when imported unbundled via plain `node`, `tsx`, or any
 * other runtime that resolves `__dirname` to bootstrap's own
 * `node_modules/@stripe/stripe-cli-plugin-bootstrap/dist/runtime/`. In that
 * case `repoRoot()` returns bootstrap's package root, not the consumer
 * plugin's. There is no way for this module to infer the consumer plugin's
 * source root when loaded unbundled from the published npm package.
 *
 * How it works:
 *
 *   Build time: `stripe-cli-generate-embedded-manifest` reads bun.assets globs,
 *   writes dist/bun-compile-entrypoint.js with `import ... with { type: "file" }`
 *   statements, and sets globalThis.__EMBEDDED_ASSET_MANIFEST__ before
 *   importing the bundle.
 *
 *   Binary mode: `getAssetDir()` extracts all embedded files to a temp
 *   directory on first call and returns that path. Cleanup runs on exit.
 *
 *   Dev mode: `getAssetDir()` returns the repo root, where assets exist on
 *   disk. No extraction needed.
 *
 * @packageDocumentation
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

declare global {
  // Set by dist/bun-compile-entrypoint.js (the Bun compile entrypoint) before
  // importing the bundle. Maps logical asset paths to $bunfs/ virtual paths.

  var __EMBEDDED_ASSET_MANIFEST__: Record<string, string> | undefined
}

let extractedDir: string | null = null

function getManifest(): Record<string, string> | null {
  return globalThis.__EMBEDDED_ASSET_MANIFEST__ ?? null
}

function repoRoot(): string {
  return path.resolve(__dirname, '..')
}

function extractAll(tempPrefix: string): string {
  const manifest = getManifest()
  if (!manifest) {
    throw new Error('extractAll called but no embedded asset manifest is present')
  }

  const tmpDir = mkdtempSync(path.join(tmpdir(), tempPrefix))

  for (const [logicalPath, bunfsPath] of Object.entries(manifest)) {
    const destPath = path.join(tmpDir, logicalPath)
    mkdirSync(path.dirname(destPath), { recursive: true })
    // Use readFileSync + writeFileSync instead of copyFileSync because
    // Bun's $bunfs/ virtual paths don't support kernel-level copy syscalls
    // (sendfile/copy_file_range) that copyFileSync uses on Linux.
    writeFileSync(destPath, readFileSync(bunfsPath))
  }

  process.on('exit', () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Process is exiting — nothing useful to do with the error
    }
  })

  return tmpDir
}

/**
 * Returns the root directory where assets can be found via filesystem paths.
 *
 * In a Bun-compiled binary: extracts all embedded assets to a temp directory
 * on first call and returns that path. Assets are laid out matching their
 * original repo-relative paths (e.g., `openapi/spec.yaml`, `sdk-bases/...`).
 * The temp directory is cleaned up on process exit.
 *
 * In dev mode (Node/tsx/vitest): returns the repo root, where assets exist
 * on disk in their original locations.
 *
 * @param tempPrefix - Prefix for the temp directory name (default: `'stripe-plugin-assets-'`).
 *   Plugins can customize this for easier debugging (e.g., `'stripe-generate-assets-'`).
 *
 * @public
 */
export function getAssetDir(tempPrefix = 'stripe-plugin-assets-'): string {
  if (!getManifest()) {
    return repoRoot()
  }

  if (!extractedDir) {
    extractedDir = extractAll(tempPrefix)
  }

  return extractedDir
}

/**
 * Resolve a specific asset file path. Convenience wrapper around
 * {@link getAssetDir}.
 *
 * @example
 * ```ts
 * import { resolveAsset } from '@stripe/stripe-cli-plugin-bootstrap/runtime'
 * const spec = resolveAsset('openapi/spec.yaml')
 * ```
 *
 * @param segments - Path segments relative to the asset root.
 *
 * @public
 */
export function resolveAsset(...segments: string[]): string {
  return path.join(getAssetDir(), ...segments)
}
