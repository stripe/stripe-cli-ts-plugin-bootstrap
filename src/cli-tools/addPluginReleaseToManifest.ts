/**
 * Ported from: stripe-cli-apps-plugin/scripts/release/addPluginReleaseToManifest.go
 *
 * Adds a new production release to the plugin manifest.
 * This script is used during the release process to add version info to plugins.toml
 *
 * Usage: node addPluginReleaseToManifest.ts <pluginName> <version> <os> <arch> <checksum> <configFilePath>
 */

import * as fs from 'fs'
import TOML from 'smol-toml'

interface Release {
  Arch: string
  OS: string
  Version: string
  Sum: string
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
  const version = process.argv[3]
  const opsys = process.argv[4]
  const arch = process.argv[5]
  const checksum = process.argv[6]
  const configFilePath = process.argv[7]

  if (!pluginName || !version || !opsys || !arch || !checksum || !configFilePath) {
    console.error(
      'Usage: node addPluginReleaseToManifest.ts <pluginName> <version> <os> <arch> <checksum> <configFilePath>',
    )
    process.exit(1)
  }

  let pc: PluginList

  try {
    const fileContent = fs.readFileSync(configFilePath, 'utf-8')
    pc = TOML.parse(fileContent) as PluginList
  } catch (err: unknown) {
    throw new Error(`Failed to read manifest file: ${err}`, { cause: err })
  }

  if (!pc.Plugin) {
    console.error('No plugins found in manifest')
    process.exit(1)
  }

  const newRelease: Release = {
    Arch: arch,
    OS: opsys,
    Version: version,
    Sum: checksum,
  }

  let foundPlugin = false

  for (let i = 0; i < pc.Plugin.length; i++) {
    const plugin = pc.Plugin[i]
    // already a plugin in the manifest with the same name, so use this instead of making a new one
    if (plugin.Shortname === pluginName) {
      foundPlugin = true
      // now check if this release already exists
      if (plugin.Release) {
        for (const release of plugin.Release) {
          if (
            release.Version === version &&
            release.OS === opsys &&
            release.Arch === arch
          ) {
            // plugin version already exists, don't overwrite anything
            console.log(
              "🤷‍♀️ This plugin version already exists in the remote plugin manifest, so we'll leave it in peace, bye!",
            )
            process.exit(1)
          }
        }
      }
      // did not find the new version which is expected, so append this new one
      if (!pc.Plugin[i].Release) {
        pc.Plugin[i].Release = []
      }
      pc.Plugin[i].Release!.push(newRelease)
      break
    }
  }

  if (!foundPlugin) {
    console.error(
      "This plugin has never been published, so out of safety we won't add it to the remote manifest.",
    )
    process.exit(1)
  }

  // Encode to TOML and write
  const tomlString = TOML.stringify(pc)
  fs.writeFileSync(configFilePath, tomlString, { mode: 0o644 })
}

main()
