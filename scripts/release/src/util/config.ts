import * as fs from 'fs'
import * as path from 'path'

/**
 * Read plugin configuration from .plugin file
 * Format: <plugin-name> <magic-cookie-value>
 */
export function readPluginConfig(): { name: string; magicCookie: string } {
  const pluginFile = path.join(process.cwd(), '.plugin')

  if (!fs.existsSync(pluginFile)) {
    throw new Error('.plugin file not found')
  }

  const content = fs.readFileSync(pluginFile, 'utf-8').trim()
  const parts = content.split(/\s+/)

  if (parts.length < 2) {
    throw new Error(
      'Invalid .plugin file format. Expected: <plugin-name> <magic-cookie-value>',
    )
  }

  return {
    name: parts[0],
    magicCookie: parts[1],
  }
}
