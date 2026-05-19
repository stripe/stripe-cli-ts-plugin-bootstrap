/**
 * Adds a plugin to the installed_plugins list in ~/.config/stripe/config.toml
 *
 * Usage: node addPluginToConfig.js <pluginName>
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as toml from 'smol-toml'

function getConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  const configDir =
    xdgConfigHome && xdgConfigHome.trim() !== ''
      ? path.resolve(xdgConfigHome)
      : path.join(os.homedir(), '.config', 'stripe')
  return path.join(configDir, 'config.toml')
}

function main() {
  const args = process.argv.slice(2)

  if (args.length < 1) {
    console.error('Usage: node addPluginToConfig.js <pluginName>')
    process.exit(1)
  }

  const pluginName = args[0]
  const configPath = getConfigPath()

  // Read existing config or create empty object
  let configData: Record<string, any> = {}
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8')
    configData = toml.parse(content) as Record<string, any>
  }

  // Get or create installed_plugins array
  const installedPlugins: string[] = configData['installed_plugins'] || []

  // Add plugin if not already present
  if (!installedPlugins.includes(pluginName)) {
    installedPlugins.push(pluginName)
    configData['installed_plugins'] = installedPlugins

    // Ensure directory exists
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
    }

    // Write back to file
    const tomlString = toml.stringify(configData)
    fs.writeFileSync(configPath, tomlString, { mode: 0o600 })

    console.log(`Added "${pluginName}" to installed_plugins in ${configPath}`)
  } else {
    console.log(`Plugin "${pluginName}" is already in installed_plugins`)
  }
}

main()
