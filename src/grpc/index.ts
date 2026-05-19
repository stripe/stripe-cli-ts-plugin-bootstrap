/**
 * TypeScript library for writing CLI plugins compatible with HashiCorp's go-plugin (gRPC protocol).
 *
 * This package exposes small, focused primitives to help you bring up a gRPC server
 * that can speak to a go-plugin host:
 *
 * - Registers the gRPC Health service and reports SERVING for service "plugin" so the host can probe readiness
 * - Emits the expected handshake line on stdout in the form `CORE|APP|NETWORK|ADDR|grpc` so the host can connect
 * - Optionally wires up the internal `GRPCStdio` and `GRPCController` services when the corresponding protos are present
 * - Lets you register your own gRPC services via a simple callback
 *
 * The most common entry point is {@link ts-cli-plugin#servePlugin}, which binds a local server and
 * writes the handshake line that the host process consumes on stdout. For convenience,
 * {@link ts-cli-plugin#formatHandshake} is also exported if you need to compute the handshake string manually.
 *
 * @packageDocumentation
 */

import * as grpc from '@grpc/grpc-js'
import {
  PluginServerImpl,
  PluginCommand,
  type PluginMetadata,
} from './plugin_server_impl.js'
import { GRPCControllerService } from './proto/plugin/grpc_controller.js'
import { GRPCStdioService } from './proto/plugin/grpc_stdio.js'
import { GRPCBrokerService } from './proto/plugin/grpc_broker.js'
import { MainService } from './proto/proto/main.js'
import { HealthService } from './proto/grpc/health/v1/health.js'
import { HealthServerImpl } from './health_server_impl.js'
import { GRPCBroker } from './grpc_broker.js'
import { addTypedService, TypedServiceImplementation } from './server.js'
import { installCrashReporter } from '../crash-reporter/index.js'

export { addTypedService, TypedServiceImplementation, PluginCommand, type PluginMetadata }
export { TerminalInfo } from './terminal-info.js'
export { CoreCLIHelper } from './core_cli_helper_client.js'
/**
 * Union of supported network types for the gRPC server.
 *
 * - "tcp": bind to a host:port (e.g. `127.0.0.1:0` for an ephemeral port)
 * - "unix": bind to a filesystem UNIX domain socket path
 *
 * @public
 */
export type NetworkType = 'tcp' | 'unix'

/**
 * Map of protocol versions to plugin implementations.
 * Each protocol version can provide a different plugin implementation.
 *
 * @example
 * ```ts
 * const versionedPlugins: VersionedPlugins = {
 *   1: new PluginV1(),
 *   2: new PluginV2(),
 *   3: new PluginV3(),
 * }
 * ```
 * @public
 */
export type VersionedPlugins = Record<number, PluginCommand>

/**
 * Options for {@link servePlugin}.
 *
 * @remarks
 * - When {@link ServeOptions.networkType} is "tcp" and the `address` omits a port,
 *   an ephemeral port is chosen automatically.
 * - When {@link ServeOptions.networkType} is "unix", the address is treated as a
 *   filesystem path and will be prefixed with `unix:` for gRPC if not already present.
 *
 * @example
 * Using multiple protocol versions:
 * ```ts
 * await servePlugin({
 *   versionedPlugins: {
 *     1: new PluginV1(),
 *     2: new PluginV2(),
 *     3: new PluginV3(),
 *   },
 *   address: "127.0.0.1:0",
 *   pluginMetadata: {
 *     name: "generate",
 *     version: "0.0.1"
 *   }
 * });
 * ```
 * @public
 */
export interface ServeOptions {
  /**
   * Map of protocol versions to plugin implementations.
   * Allows serving multiple protocol versions simultaneously.
   * The CLI will negotiate which version to use during the handshake.
   */
  versionedPlugins: VersionedPlugins
  /**
   * Address to bind.
   * - For "tcp", use `host:port` (e.g. `127.0.0.1:0` to select an ephemeral port)
   * - For "unix", provide the socket path (e.g. `/tmp/my.sock`)
   */
  address: string
  /** Network type for the gRPC server. Defaults to "tcp". */
  networkType?: NetworkType
  /**
   * Plugin metadata for telemetry.
   * If provided, the bootstrap will automatically send analytics events
   * for command lifecycle (started, completed, duration, error).
   */
  pluginMetadata?: PluginMetadata
}

/**
 * Formats the handshake line that the go-plugin host expects on stdout.
 *
 * The format is: `CORE|APP|NETWORK|ADDR|PROTOCOL` (example: `1|1|tcp|127.0.0.1:12345|grpc`).
 *
 * @param coreProtocolVersion - The core protocol version (typically `1`).
 * @param appProtocolVersion - The application protocol version that your plugin implements.
 * @param networkType - The network type to advertise to the host.
 * @param address - The advertised address. For "tcp" this is `host:port`. For "unix" this is a path.
 * @param protocol - The transport protocol identifier. Defaults to `"grpc"`.
 * @returns The handshake string that should be written to stdout.
 *
 * @example
 * ```ts
 * const line = formatHandshake(1, 1, "tcp", "127.0.0.1:34567", "grpc");
 * // => "1|1|tcp|127.0.0.1:34567|grpc"
 * ```
 *
 * @public
 */
export function formatHandshake(
  coreProtocolVersion: number,
  appProtocolVersion: number,
  networkType: NetworkType,
  address: string,
  protocol: 'grpc' | 'netrpc' = 'grpc',
): string {
  return `${coreProtocolVersion}|${appProtocolVersion}|${networkType}|${address}|${protocol}`
}

/**
 * Determines which protocol version to use based on CLI-supported versions and plugin capabilities.
 *
 * @param versionedPlugins - Map of protocol versions to plugin implementations
 * @returns The negotiated protocol version to use
 * @throws If no compatible version is found
 *
 * @remarks
 * The CLI communicates supported versions via the `PLUGIN_PROTOCOL_VERSIONS` environment variable
 * as a comma-separated list (e.g., "1,2,3"). This function selects the highest version supported
 * by both the CLI and the plugin.
 */
function negotiateProtocolVersion(versionedPlugins: VersionedPlugins): number {
  const pluginVersions = Object.keys(versionedPlugins)
    .map(Number)
    .sort((a, b) => b - a) // Sort descending

  // Check if CLI specified supported versions via environment variable
  const cliVersionsEnv = process.env.PLUGIN_PROTOCOL_VERSIONS
  if (cliVersionsEnv !== undefined) {
    const cliVersions = cliVersionsEnv
      .split(',')
      .map(v => parseInt(v.trim(), 10))
      .filter(v => !isNaN(v))
      .sort((a, b) => b - a) // Sort descending

    // Find highest common version
    for (const pluginVer of pluginVersions) {
      if (cliVersions.includes(pluginVer)) {
        return pluginVer
      }
    }

    throw new Error(
      `No compatible protocol version found. CLI supports: [${cliVersions.join(', ')}], Plugin supports: [${pluginVersions.join(', ')}]`,
    )
  }

  // No CLI version specified, use highest plugin version
  if (pluginVersions.length === 0) {
    throw new Error('No plugin versions provided in versionedPlugins')
  }

  return pluginVersions[0]
}

/**
 * Starts a gRPC server suitable for a go-plugin host and writes the handshake line to stdout.
 *
 * This function:
 * - Registers a minimal gRPC Health service and reports `SERVING` for service "plugin"
 * - Optionally registers the internal `GRPCStdio` and `GRPCController` services if the
 *   corresponding protos are available (when the `go-plugin` submodule exists)
 * - Registers a protos.Main service, which invokes your {@link ServeOptions.versionedPlugins | versioned plugins} runCommand
 *   method to handle issued commands.
 * - Binds the server to the requested address (choosing an ephemeral port for TCP if none supplied)
 * - Emits a single handshake line to stdout using {@link formatHandshake}
 *
 * @param options - Server configuration and (optional) service registration callback.
 * @returns An object containing the started `server`, `address`, and negotiated `protocolVersion`.
 *
 * @remarks
 * - For `networkType` "tcp", if you omit the port (e.g. `127.0.0.1`), an ephemeral port is chosen and returned.
 * - For `networkType` "unix", the path will be prefixed with `unix:` as required by gRPC if not already present.
 * - This function writes the handshake line to `process.stdout` exactly once after the server starts.
 * - When internal protos are present, stdout/stderr writes are mirrored over the `GRPCStdio` stream expected by the host.
 * - Protocol version negotiation: The CLI can specify supported versions via `PLUGIN_PROTOCOL_VERSIONS` env var.
 *   The plugin will select the highest mutually supported version.
 *
 * @throws If the server fails to bind to the requested address.
 * @throws If no compatible protocol version can be negotiated.
 *
 * @example
 * Start a server with multiple protocol versions:
 * ```ts
 * const { server, address, protocolVersion } = await servePlugin({
 *   versionedPlugins: {
 *     1: new PluginV1(),
 *     2: new PluginV2(),
 *     3: new PluginV3(),
 *   },
 *   address: "127.0.0.1:0",
 * });
 * console.log("listening on", address, "using protocol version", protocolVersion);
 * ```
 *
 * @public
 */
export async function servePlugin(
  options: ServeOptions,
): Promise<{ server: grpc.Server; address: string; protocolVersion: number }> {
  // Install crash handlers before anything else so unhandled errors during
  // server setup are captured in the crash log.
  installCrashReporter(
    options.pluginMetadata?.name ?? 'unknown',
    options.pluginMetadata?.version,
  )

  const networkType: NetworkType = options.networkType ?? 'tcp'
  const server = new grpc.Server()

  // Determine which plugin to use based on protocol version
  const selectedVersion = negotiateProtocolVersion(options.versionedPlugins)
  const selectedPlugin = options.versionedPlugins[selectedVersion]

  const healthServerImpl = new HealthServerImpl()
  addTypedService(server, HealthService, healthServerImpl)

  const broker = new GRPCBroker()

  const pluginServerImpl = new PluginServerImpl(
    server.forceShutdown.bind(server),
    selectedPlugin,
    broker,
    options.pluginMetadata,
  )
  addTypedService(server, GRPCControllerService, pluginServerImpl)
  addTypedService(server, GRPCStdioService, pluginServerImpl)
  addTypedService(server, GRPCBrokerService, broker)
  addTypedService(server, MainService, pluginServerImpl)

  // Bind
  let bindAddress = options.address
  if (networkType === 'unix' && !bindAddress.startsWith('unix:')) {
    bindAddress = `unix:${bindAddress}`
  }
  if (networkType === 'tcp' && /:\d+$/.test(bindAddress) === false) {
    // If host omitted port, default to ephemeral
    bindAddress = `${bindAddress}:0`
  }

  const creds = grpc.ServerCredentials.createInsecure()
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(bindAddress, creds, (err, actualPort) => {
      if (err) return reject(err)
      resolve(actualPort)
    })
  })

  let advertisedAddress = bindAddress
  if (networkType === 'tcp') {
    const host = bindAddress.split(':')[0] || '127.0.0.1'
    advertisedAddress = `${host}:${port}`
  }

  server.start()

  // Output handshake to stdout exactly once
  const handshake = formatHandshake(
    1,
    selectedVersion,
    networkType,
    advertisedAddress,
    'grpc',
  )
  process.stdout.write(handshake + '\n')

  return { server, address: advertisedAddress, protocolVersion: selectedVersion }
}
