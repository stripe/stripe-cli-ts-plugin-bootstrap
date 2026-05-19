#!/usr/bin/env node
import { execSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import toml from 'smol-toml'
import { removeVPrefix } from './util/version'
import { readPluginConfig } from './util/config'

/**
 * Updates the plugin manifest (plugins.toml) with new release entries.
 *
 * This script:
 * 1. Reads the plugin name from .plugin file
 * 2. Ensures the plugin exists in the manifest (adds if first-time publish)
 * 3. Finds all built binaries in the bin/ directory
 * 4. Computes SHA256 checksums for each binary
 * 5. Calls addPluginReleaseToManifest for each platform/arch combination
 *
 * Usage: tsx src/updateManifest.ts <version> <manifest-file> [bin-dir]
 *
 * Example:
 *   tsx src/updateManifest.ts 0.0.2 plugins.toml
 *   tsx src/updateManifest.ts v0.0.2 plugins.toml ./custom-bin-dir
 */

interface ParsedBinary {
  os: string
  arch: string
}

interface Plugin {
  Shortname: string
  Shortdesc?: string
  Binary: string
  MagicCookieValue: string
  Release?: Array<{
    Arch: string
    OS: string
    Version: string
    Sum: string
  }>
}

interface Manifest {
  Plugin?: Plugin[]
}

// Map build-target platform/arch tokens to go-plugin OS/arch naming.
const platformMap: Record<string, string> = {
  macos: 'darwin',
  linux: 'linux',
  win: 'windows',
}

const archMap: Record<string, string> = {
  arm64: 'arm64',
  x64: 'amd64',
}

/**
 * Ensure the plugin exists in the manifest
 * If it doesn't exist, add a new plugin entry
 */
function ensurePluginExists(
  manifestFile: string,
  pluginName: string,
  magicCookie: string,
): void {
  // Read and parse the manifest
  const manifestContent = fs.readFileSync(manifestFile, 'utf-8')
  const manifest = toml.parse(manifestContent) as Manifest

  if (!manifest.Plugin) {
    manifest.Plugin = []
  }

  // Check if plugin already exists
  const existingPlugin = manifest.Plugin.find(p => p.Shortname === pluginName)

  if (existingPlugin) {
    console.log(`Plugin "${pluginName}" already exists in manifest`)
    return
  }

  // Add new plugin entry
  console.log(`Adding new plugin "${pluginName}" to manifest`)

  const newPlugin: Plugin = {
    Shortname: pluginName,
    Shortdesc: '',
    Binary: `stripe-cli-${pluginName}`,
    MagicCookieValue: magicCookie,
    Release: [],
  }

  manifest.Plugin.push(newPlugin)

  // Write back to file
  const tomlString = toml.stringify(manifest)
  fs.writeFileSync(manifestFile, tomlString, { mode: 0o644 })

  console.log(`✓ Added plugin to manifest`)
  console.log('')
}

/**
 * Compute SHA256 checksum of a file
 */
function computeChecksum(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha256')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

/**
 * Parse platform and architecture from binary filename
 * Format: stripe-cli-{plugin}-{platform}-{arch}[.exe]
 */
function parseBinaryName(filename: string, pluginName: string): ParsedBinary | null {
  // Remove .exe extension if present
  const basename = filename.replace(/\.exe$/, '')

  // Expected format: stripe-cli-{plugin}-{platform}-{arch}
  const expectedPrefix = `stripe-cli-${pluginName}-`

  if (!basename.startsWith(expectedPrefix)) {
    return null
  }

  // Extract platform-arch part
  const suffix = basename.substring(expectedPrefix.length)
  const parts = suffix.split('-')

  if (parts.length !== 2) {
    return null
  }

  const [pkgPlatform, pkgArch] = parts

  // Map to go-plugin naming
  const os = platformMap[pkgPlatform]
  const arch = archMap[pkgArch]

  if (!os || !arch) {
    console.warn(
      `Warning: Unknown platform/arch in ${filename}: ${pkgPlatform}/${pkgArch}`,
    )
    return null
  }

  return { os, arch }
}

/**
 * Call addPluginReleaseToManifest for a single binary
 */
function addReleaseToManifest(
  binaryPath: string,
  os: string,
  arch: string,
  version: string,
  pluginName: string,
  manifestFile: string,
): void {
  const checksum = computeChecksum(binaryPath)

  console.log(`Adding release: ${os}/${arch}`)
  console.log(`  Binary: ${path.basename(binaryPath)}`)
  console.log(`  Checksum: ${checksum}`)

  try {
    // Find the addPluginReleaseToManifest script from bootstrap package
    const bootstrapPkg =
      require.resolve('@stripe/stripe-cli-plugin-bootstrap/package.json')
    const bootstrapDir = path.dirname(bootstrapPkg)
    const scriptPath = path.join(
      bootstrapDir,
      'dist',
      'cli-tools',
      'addPluginReleaseToManifest.js',
    )

    // Call: node addPluginReleaseToManifest.js <pluginName> <version> <os> <arch> <checksum> <manifestFile>
    execSync(
      `node "${scriptPath}" "${pluginName}" "${version}" "${os}" "${arch}" "${checksum}" "${manifestFile}"`,
      { stdio: 'inherit' },
    )

    console.log(`  ✓ Added to manifest`)
    console.log('')
  } catch (error) {
    console.error(`  ✗ Failed to add to manifest`)
    throw error
  }
}

function main() {
  // Parse arguments
  const rawVersion = process.argv[2]
  const manifestFile = process.argv[3]
  const binDir = process.argv[4] || path.join(process.cwd(), 'bin')

  if (!rawVersion || !manifestFile) {
    console.error('Usage: tsx src/updateManifest.ts <version> <manifest-file> [bin-dir]')
    console.error('')
    console.error('Arguments:')
    console.error('  version       - Plugin version (e.g., 0.0.2 or v0.0.2)')
    console.error('  manifest-file - Path to plugins.toml manifest file')
    console.error(
      '  bin-dir       - Optional: Directory containing binaries (default: ./bin)',
    )
    process.exit(1)
  }

  const version = removeVPrefix(rawVersion)
  const { name: pluginName, magicCookie } = readPluginConfig()

  console.log(`Updating manifest for plugin: ${pluginName}`)
  console.log(`Version: ${version}`)
  console.log(`Manifest file: ${manifestFile}`)
  console.log(`Binary directory: ${binDir}`)
  console.log('')

  // Check if binaries directory exists
  if (!fs.existsSync(binDir)) {
    console.error(`ERROR: Binary directory not found: ${binDir}`)
    console.error('Run "pnpm build:package" first to build binaries')
    process.exit(1)
  }

  // Check if manifest file exists
  if (!fs.existsSync(manifestFile)) {
    console.error(`ERROR: Manifest file not found: ${manifestFile}`)
    process.exit(1)
  }

  // Ensure plugin exists in manifest before adding releases
  ensurePluginExists(manifestFile, pluginName, magicCookie)

  // Find all binaries in the bin directory
  const files = fs.readdirSync(binDir)
  const binaries = files.filter(file => {
    const fullPath = path.join(binDir, file)
    return fs.statSync(fullPath).isFile() && file.startsWith(`stripe-cli-${pluginName}-`)
  })

  if (binaries.length === 0) {
    console.error(`ERROR: No binaries found in ${binDir}`)
    console.error(`Expected files matching pattern: stripe-cli-${pluginName}-*`)
    process.exit(1)
  }

  console.log(`Found ${binaries.length} binaries:`)
  binaries.forEach(b => console.log(`  - ${b}`))
  console.log('')

  // Process each binary
  let successCount = 0
  let failureCount = 0

  for (const binary of binaries) {
    const binaryPath = path.join(binDir, binary)
    const parsed = parseBinaryName(binary, pluginName)

    if (!parsed) {
      console.warn(`Skipping unrecognized binary: ${binary}`)
      failureCount++
      continue
    }

    try {
      addReleaseToManifest(
        binaryPath,
        parsed.os,
        parsed.arch,
        version,
        pluginName,
        manifestFile,
      )
      successCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Failed to process ${binary}: ${errorMessage}`)
      failureCount++
    }
  }

  console.log('Summary:')
  console.log(`  ✓ Successfully added: ${successCount}`)
  if (failureCount > 0) {
    console.log(`  ✗ Failed: ${failureCount}`)
    process.exit(1)
  }

  console.log('')
  console.log('🎉 Manifest updated successfully!')
}

main()
