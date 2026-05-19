# @stripe/stripe-cli-plugin-bootstrap

Foundation library for building TypeScript Stripe CLI plugins. This package provides:

- **gRPC Plugin Server**: Implements HashiCorp's go-plugin protocol for CLI plugin communication
- **Configuration Management**: Read/write Stripe CLI config files (`~/.config/stripe/config.toml`)
- **Telemetry Utilities**: Helpers for plugin telemetry integration
- **CLI Utilities**: Pre-configured yargs setup with global flags
- **Build Tools**: Scripts for building and installing plugins locally

## Installing

This package is published to GitHub Packages. Configure your package manager to use it:

```bash
# For npm
npm config set @stripe:registry https://npm.pkg.github.com
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" >> ~/.npmrc

# For pnpm
pnpm config set @stripe:registry https://npm.pkg.github.com
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" >> ~/.npmrc
```

Your token needs the `read:packages` scope.

## Getting Started: Building a Plugin

### Step 0: Create a new project

Create a new npm project and add bootstrap as a dependency:

```bash
mkdir my-stripe-plugin
cd my-stripe-plugin
pnpm init
pnpm add @stripe/stripe-cli-plugin-bootstrap
```

### Step 1: Initialize your plugin

Run the init script to set up your plugin. This will prompt for your plugin name and generate a unique magic cookie (UUID) for handshake verification:

```bash
pnpm exec stripe-cli-init-plugin
```

This creates a `.plugin` file with your plugin name and magic cookie:

```
myplugin XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```

### Step 2: Create the entry point

Create a `src/main.ts` that imports `servePlugin` and starts your plugin. The plugin uses versioned plugins to support multiple protocol versions:

```ts
// src/main.ts
import { servePlugin } from '@stripe/stripe-cli-plugin-bootstrap'
import { MyPlugin } from './plugin'

async function main() {
  await servePlugin({
    versionedPlugins: {
      3: new MyPlugin(),
    },
    address: process.env.PLUGIN_ADDRESS || '127.0.0.1:0',
    networkType: 'tcp',
  })
}

main().catch(err => {
  console.error('Plugin startup failed:', err)
  process.exit(1)
})
```

The plugin will automatically negotiate the protocol version:

- If the Stripe CLI sets `PLUGIN_PROTOCOL_VERSIONS` env var (e.g., `"2,3"`), the plugin selects the highest common version
- Otherwise, the plugin uses the highest version it supports
- The handshake line advertises the negotiated version

This pattern matches HashiCorp's go-plugin `VersionedPlugins` option and allows graceful evolution of your plugin API.

### Step 3: Implement the plugin class

Create a `src/plugin.ts` that implements `PluginCommand`. Use `getPluginYargs()` to get a pre-configured yargs instance with global flags:

```ts
// src/plugin.ts
import {
  PluginCommand,
  getPluginYargs,
  GlobalFlags,
  CoreCLIHelper,
} from '@stripe/stripe-cli-plugin-bootstrap'
import * as yargs from 'yargs'
import * as commands from './commands'

export class MyPlugin implements PluginCommand {
  private pluginYargs: yargs.Argv<GlobalFlags>

  constructor() {
    // 'myplugin' becomes the script name: `stripe myplugin <command>`
    this.pluginYargs = getPluginYargs('myplugin')

    // Register your commands
    for (const cmd of Object.values(commands)) {
      this.pluginYargs = cmd.connect(this.pluginYargs)
    }
  }

  async runCommand(args: string[], coreCLIHelper?: CoreCLIHelper): Promise<void> {
    // use coreCLIHelper to call back into the host Stripe CLI process, like emitting analytics and managing API keys
    await this.pluginYargs.parseAsync(args)
  }
}
```

### Step 4: Create commands

Create commands in `src/commands/`. Each command exports an object with a `connect(yargs)` method:

```ts
// src/commands/hello.ts
import * as yargs from 'yargs'
import { GlobalFlags } from '@stripe/stripe-cli-plugin-bootstrap'

export const helloCommand = {
  connect(yargsInstance: yargs.Argv<GlobalFlags>): yargs.Argv<GlobalFlags> {
    return yargsInstance.command(
      'hello <name>',
      'Say hello to someone',
      y =>
        y.positional('name', {
          description: 'Name to greet',
          type: 'string',
        }),
      async args => {
        console.log(`Hello, ${args.name}!`)
      },
    )
  },
}
```

### Step 5: Export commands from an index

```ts
// src/commands/index.ts
export { helloCommand } from './hello'
export { anotherCommand } from './another'
```

### Step 6: Build and install

Build your plugin and install it locally:

```bash
pnpm build
pnpm exec stripe-cli-install-plugin
```

Then test it:

```bash
stripe myplugin hello world
```

## Building

### Development build

```bash
# Build the JavaScript bundle
pnpm build
```

### Building binaries

The bootstrap package provides `stripe-cli-build-binaries` to create standalone executables:

```bash
# Build binary for current platform
pnpm exec stripe-cli-build-binaries ./bin

# Build for a specific target (canonical target name)
pnpm exec stripe-cli-build-binaries ./bin macos-arm64

# Legacy node18-* aliases are still accepted for backwards-compat
pnpm exec stripe-cli-build-binaries ./bin node18-macos-arm64
```

Supported targets: `macos-arm64`, `macos-x64`, `linux-x64`, `linux-arm64`, `win-x64`

Legacy aliases accepted for backwards-compat: `node18-macos-arm64`, `node18-macos-x64`, `node18-linux-x64`, `node18-linux-arm64`, `node18-win-x64`

#### Build-time requirement: Bun

`stripe-cli-build-binaries` uses [Bun](https://bun.sh)'s `bun build --compile`
to produce standalone plugin binaries. **Bun must be installed on PATH to run
`stripe-cli-build-binaries`.** The required minimum Bun version is pinned in
`.tool-versions` at the repo root (currently `1.3.13`) and enforced by
`stripe-cli-build-binaries`, which exits with an actionable error if `bun` is
missing or older than the required version.

Install Bun with any of:

```bash
# Official installer:
curl -fsSL https://bun.sh/install | bash

# Homebrew:
brew install oven-sh/bun/bun

# mise / asdf (reads .tool-versions):
mise install bun
# or: asdf install bun
```

Bun is **only** needed for the binary-compile path. `pnpm build`, `pnpm test`,
and `pnpm lint` continue to run on Node without Bun.

#### Embedding assets

If your plugin needs data files at runtime (OpenAPI specs, templates, etc.),
declare them in your plugin's `package.json` under `bun.assets`:

```json
{
  "bun": {
    "assets": ["openapi/**/*", "sdk-bases/**/*", "templates/**/*"]
  }
}
```

`stripe-cli-build-binaries` expands those globs, embeds every matched file
directly into the compiled binary using Bun's `import ... with { type: "file" }`
attribute, and produces a single self-contained executable.

At runtime, resolve asset paths through
`@stripe/stripe-cli-plugin-bootstrap/runtime`:

```ts
import * as fs from 'node:fs/promises'
import * as yaml from 'yaml'
import { resolveAsset } from '@stripe/stripe-cli-plugin-bootstrap/runtime'

const specPath = resolveAsset('openapi/spec3.sdk.yaml')
const spec = yaml.parse(await fs.readFile(specPath, 'utf8'))
```

In a compiled binary, `getAssetDir()` extracts embedded files to a temp
directory on first call and returns that path. The temp directory is cleaned up
on process exit. In dev mode (Node/tsx/vitest), it returns the repo root where
assets exist on disk.

> **Bundled consumption only.** These helpers rely on `__dirname` resolving to
> the _consumer plugin's_ `dist/` directory. This works when esbuild bundles
> the import into the plugin's `dist/bundle.js`. It does **not** work when
> imported unbundled via plain `node` or `tsx` — in that case `__dirname`
> points into bootstrap's own `dist/runtime/`.
> Any publish, archive, or install flow must preserve that sibling layout inside
> `~/.config/stripe/plugins/<shortname>/<version>/` (or any equivalent release
> directory), or runtime file reads will fail.

## Installing locally

To install a plugin for local development with the Stripe CLI:

```bash
# Build and install to ~/.config/stripe/plugins/<plugin-name>/local.build.dev/
pnpm exec stripe-cli-install-plugin
```

This script:

1. Reads your plugin name and magic cookie from `.plugin`
2. Builds a binary for your current platform
3. Copies the binary and any declared `bun.assets` sibling files to `~/.config/stripe/plugins/<plugin-name>/local.build.dev/`
4. Updates `~/.config/stripe/plugins.toml` with the plugin entry
5. Computes and updates the checksum

After installation, you can run your plugin via the Stripe CLI:

```bash
stripe myplugin hello world
```

### Building without installing

To build a local binary without installing to the Stripe CLI plugins directory:

```bash
pnpm exec stripe-cli-build-local
```

This creates the binary at
`./bin/<plugin-name>/local.build.dev/stripe-cli-<plugin-name>` and copies any
declared `bun.assets` siblings into the same local build directory.

## Testing

```bash
# Run tests with vitest
pnpm test
```

## Publishing

TBD - Publishing workflow for distributing plugins.

## Configuration management

Access Stripe CLI configuration (profiles, API keys, etc.):

```ts
import { initializeConfig, getStripeCLIConfig } from '@stripe/stripe-cli-plugin-bootstrap'

// Initialize config (reads ~/.config/stripe/config.toml)
const config = initializeConfig('default')

// Get API key for current profile
const profile = config.getProfile()
const apiKey = await profile.getAPIKey(false) // false = test mode
```

## Telemetry

Wrap your command handler with telemetry (when fully implemented):

```ts
import { withTelemetry, PluginInfo } from '@stripe/stripe-cli-plugin-bootstrap'

const pluginInfo: PluginInfo = {
  name: 'my-plugin',
  version: '1.0.0',
}

const execute = withTelemetry(async (args: string[]) => {
  // Your command implementation
}, pluginInfo)
```

## API reference

### `servePlugin(options)`

Boots the plugin gRPC server and prints the handshake line to stdout.

```ts
type NetworkType = 'tcp' | 'unix'

interface PluginCommand {
  runCommand(args: string[]): Promise<void>
}

interface ServeOptions {
  appProtocolVersion: number // host-defined application version
  address: string // e.g. "127.0.0.1:0" for ephemeral port
  networkType?: NetworkType // default "tcp"
  plugin: PluginCommand // your command handler
}
```

Behavior:

- Health service is registered and returns SERVING for service "plugin"
- Internal `GRPCStdio` and `GRPCController` services are registered automatically
- The `proto.Main` service is registered to invoke your plugin's `runCommand` method
- For `tcp`, the server binds to an ephemeral port and prints the final `host:port` in the handshake

### `getPluginYargs(pluginName)`

Returns a yargs instance pre-configured with Stripe CLI global flags:

```ts
const yargs = getPluginYargs('myplugin')
// Includes: --api-key, --color, --config, --device-name, --log-level, --project-name
```

### `formatHandshake(core, app, network, addr, protocol)`

Returns a string in the format required by go-plugin:

```ts
const line = formatHandshake(1, 2, 'tcp', '127.0.0.1:34567', 'grpc')
// => "1|2|tcp|127.0.0.1:34567|grpc"
```

### `addTypedService(server, service, impl)`

Type-safe helper for registering gRPC services on a server:

```ts
import { addTypedService } from '@stripe/stripe-cli-plugin-bootstrap'
import { MyService, MyServer } from './proto/my_service'

addTypedService(server, MyService, myImplementation)
```

## Internal plugin services

This library automatically registers the internal services that the go-plugin host expects:

- `plugin.GRPCStdio` - Streams stdout/stderr to the host process
- `plugin.GRPCController` - Handles shutdown requests
- `grpc.health.v1.Health` - Health check service (reports SERVING for "plugin")
- `proto.Main` - Command dispatch service (invokes your `PluginCommand.runCommand`)

## Handshake protocol

When the plugin starts, it prints a handshake line to stdout:

```
CORE-PROTOCOL-VERSION|APP-PROTOCOL-VERSION|NETWORK-TYPE|NETWORK-ADDR|grpc
```

Example: `1|2|tcp|127.0.0.1:12345|grpc`

The host process parses this line to connect to the plugin's gRPC server.

## Health service

The gRPC Health service reports `SERVING` for the service name `"plugin"`. This allows the host to probe plugin readiness.

## Terminal info

The `TerminalInfo` class provides information about whether the host's stdout/stderr are terminals:

```ts
import { TerminalInfo } from '@stripe/stripe-cli-plugin-bootstrap'

if (TerminalInfo.hostStdoutIsTerminal) {
  // Use colors, interactive output, etc.
}
```

## Further reading

For more details on the go-plugin protocol, see:

- [hashicorp/go-plugin](https://github.com/hashicorp/go-plugin) - The upstream plugin framework
- Writing plugins without Go (gRPC): see `docs/guide-plugin-write-non-go.md` in the upstream repo
