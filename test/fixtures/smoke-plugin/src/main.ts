#!/usr/bin/env node
import * as fs from 'node:fs'
import { servePlugin, type PluginCommand } from '@stripe/stripe-cli-plugin-bootstrap'
import { resolveAsset } from '@stripe/stripe-cli-plugin-bootstrap/runtime'

const POST_HANDSHAKE_MARKER = 'SMOKE_POST_HANDSHAKE_MARKER'

class SmokePlugin implements PluginCommand {
  async runCommand(args: string[]): Promise<void> {
    console.log(`${POST_HANDSHAKE_MARKER} stdout args=${JSON.stringify(args)}`)
    console.error(`${POST_HANDSHAKE_MARKER} stderr args=${JSON.stringify(args)}`)

    // Read the declared `bun.assets` asset via the bootstrap runtime helper.
    // In embedded mode (Bun binary), the asset is extracted from the binary to
    // a temp dir. In dev mode, it reads from the source tree.
    const assetPath = resolveAsset('data.txt')
    let assetBody: string
    try {
      assetBody = fs.readFileSync(assetPath, 'utf8').trim()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`EMBEDDED_ASSET_READ_FAILED path=${assetPath} err=${msg}`)
      return
    }
    console.log(`EMBEDDED_ASSET_CONTENT ${assetBody}`)
  }
}

async function main() {
  await servePlugin({
    versionedPlugins: {
      3: new SmokePlugin(),
    },
    address: process.env.PLUGIN_ADDRESS || '127.0.0.1:0',
    networkType: 'tcp',
  })
}

main().catch(err => {
  console.error('smoke-plugin startup failed:', err)
  process.exit(1)
})
