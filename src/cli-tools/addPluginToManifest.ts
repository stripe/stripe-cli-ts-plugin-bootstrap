#!/usr/bin/env node
/**
 * Ported from: stripe-cli-apps-plugin/scripts/addPluginToManifest.go
 *
 * Adds a plugin entry to ~/.config/stripe/plugins.toml for local development.
 * Creates or updates a "local.build.dev" release entry for the plugin.
 *
 * Usage: node addPluginToManifest.ts <pluginName> <magicCookieValue> [nodeVersion]
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import TOML from 'smol-toml'

interface Release {
  Arch: string
  OS: string
  Version: string
  Sum: string
  Runtime?: { node: string }
}

interface Plugin {
  Shortname: string
  Shortdesc?: string
  Binary: string
  MagicCookieValue: string
  Release?: Release[]
}

interface PluginList {
  Plugin?: Plugin[]
}

function validateNodeVersion(version: string): boolean {
  const versionNum = parseInt(version, 10)

  if (isNaN(versionNum)) {
    return false
  }

  if (versionNum % 2 !== 0) {
    return false
  }

  if (versionNum < 20) {
    return false
  }

  return true
}

function main() {
  const pluginName = process.argv[2]
  const magicCookieValue = process.argv[3]
  const nodeVersion = process.argv[4] // Optional: major version like "20"

  if (!pluginName || !magicCookieValue) {
    console.error(
      'Usage: node addPluginToManifest.ts <pluginName> <magicCookieValue> [nodeVersion]',
    )
    process.exit(1)
  }

  // Validate node version if provided
  if (nodeVersion !== undefined && !validateNodeVersion(nodeVersion)) {
    console.error(
      `Invalid node version: ${nodeVersion}. Must be an even number >= 20 (e.g., 20, 22, 24)`,
    )
    process.exit(1)
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  const stripeConfigDir =
    xdgConfigHome && xdgConfigHome.trim() !== ''
      ? path.join(path.resolve(xdgConfigHome), 'stripe')
      : path.join(os.homedir(), '.config', 'stripe')
  const configFilePath = path.join(stripeConfigDir, 'plugins.toml')

  let pc: PluginList = { Plugin: [] }

  // Read existing plugins.toml if it exists
  try {
    const fileContent = fs.readFileSync(configFilePath, 'utf-8')
    pc = TOML.parse(fileContent) as PluginList
    if (!pc.Plugin) {
      pc.Plugin = []
    }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      // File doesn't exist, will create it
      pc.Plugin = []
    } else {
      throw new Error(`Failed to read plugins.toml: ${err}`, { cause: err })
    }
  }

  const devRelease: Release = {
    Arch: process.arch === 'x64' ? 'amd64' : process.arch,
    OS: process.platform === 'win32' ? 'windows' : process.platform,
    Version: 'local.build.dev',
    Sum: '',
    ...(nodeVersion ? { Runtime: { node: nodeVersion } } : {}),
  }

  const newPlugin: Plugin = {
    Shortname: pluginName,
    Binary: `stripe-cli-${pluginName}`,
    MagicCookieValue: magicCookieValue,
    Release: [devRelease],
  }

  let foundPlugin = false
  let foundRelease = false

  for (let i = 0; i < pc.Plugin.length; i++) {
    const plugin = pc.Plugin[i]
    // already a plugin in the manifest with the same name, so use this instead of making a new one
    if (plugin.Shortname === pluginName) {
      foundPlugin = true
      // now check for a dev release entry
      if (plugin.Release) {
        for (let j = 0; j < plugin.Release.length; j++) {
          const release = plugin.Release[j]
          if (release.Version === 'local.build.dev') {
            pc.Plugin[i].MagicCookieValue = magicCookieValue
            // Update or clear Runtime field based on whether nodeVersion is provided
            if (nodeVersion) {
              pc.Plugin[i].Release![j].Runtime = { node: nodeVersion }
            } else {
              delete pc.Plugin[i].Release![j].Runtime
            }
            foundRelease = true
            break
          }
        }
      }
      if (!foundRelease) {
        // did not find a local build release, prepend a new one
        if (!pc.Plugin[i].Release) {
          pc.Plugin[i].Release = []
        }
        pc.Plugin[i].Release = [devRelease, ...(pc.Plugin[i].Release || [])]
      }
      break
    }
  }

  if (!foundPlugin) {
    // add a new plugin with a new dev release
    pc.Plugin.push(newPlugin)
  }

  // Encode to TOML and write
  let tomlString = TOML.stringify(pc)

  // Post-process: Convert nested Runtime tables to inline tables
  // Replace [Plugin.Release.Runtime]\nnode = "XX" with Runtime = { node = "XX" }
  tomlString = tomlString.replace(
    /\n\n\[Plugin\.Release\.Runtime\]\nnode = "(\d+)"/g,
    '\nRuntime = { node = "$1" }',
  )

  // Ensure directory exists
  const configDir = path.dirname(configFilePath)
  fs.mkdirSync(configDir, { recursive: true })

  fs.writeFileSync(configFilePath, tomlString, { mode: 0o644 })
}

main()
