#!/usr/bin/env node
/**
 * Ported from: stripe-cli-apps-plugin/scripts/updateChecksum.go
 *
 * Updates the checksum for the local.build.dev release of a plugin in ~/.config/stripe/plugins.toml
 *
 * Usage: node updateChecksum.ts <pluginName> <checksum>
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

function main() {
  const pluginName = process.argv[2]
  const checksum = process.argv[3]

  if (!pluginName || !checksum) {
    console.error('Usage: node updateChecksum.ts <pluginName> <checksum>')
    process.exit(1)
  }

  const homeDir = os.homedir()
  const configFilePath = path.join(homeDir, '.config', 'stripe', 'plugins.toml')

  let pc: PluginList

  try {
    const fileContent = fs.readFileSync(configFilePath, 'utf-8')
    pc = TOML.parse(fileContent) as PluginList
  } catch (err: unknown) {
    throw new Error(`Failed to read plugins.toml: ${err}`, { cause: err })
  }

  if (!pc.Plugin) {
    console.error("❌ OOPS couldn't find any plugins in the manifest")
    process.exit(1)
  }

  const arch = process.arch === 'x64' ? 'amd64' : process.arch
  const platform = process.platform === 'win32' ? 'windows' : process.platform

  let foundPlugin = false

  for (let i = 0; i < pc.Plugin.length; i++) {
    if (pc.Plugin[i].Shortname === pluginName) {
      if (pc.Plugin[i].Release) {
        for (let j = 0; j < pc.Plugin[i].Release!.length; j++) {
          const release = pc.Plugin[i].Release![j]
          if (
            release.Version === 'local.build.dev' &&
            release.Arch === arch &&
            release.OS === platform
          ) {
            foundPlugin = true
            pc.Plugin[i].Release![j].Sum = checksum
          }
        }
      }
    }
  }

  if (!foundPlugin) {
    console.error(
      "❌ OOPS couldn't find the plugin's local build release entry in the manifest; checksum not updated.",
    )
    process.exit(1)
  }

  // Encode to TOML and write
  let tomlString = TOML.stringify(pc)

  // Post-process: Convert nested Runtime tables to inline tables
  // Replace [Plugin.Release.Runtime]\nnode = "XX" with Runtime = { node = "XX" }
  tomlString = tomlString.replace(
    /\n\n\[Plugin\.Release\.Runtime\]\nnode = "(\d+)"/g,
    '\nRuntime = { node = "$1" }',
  )

  fs.writeFileSync(configFilePath, tomlString, { mode: 0o644 })
}

main()
