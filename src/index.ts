/**
 * @stripe/stripe-cli-plugin-bootstrap
 *
 * TypeScript port of the Go-based stripe-cli-plugin-bootstrap/v2 library
 *
 * Provides configuration management and gRPC plugin utilities
 * for building Stripe CLI plugins.
 */

import yargs, { type Argv } from 'yargs'

export * from './config/index.js'
export * from './command-tree.js'
export * from './esbuild.js'
export * from './interactive/index.js'
export * from './colors.js'
export * from './stripe-client/index.js'
export {
  initLogger,
  log,
  logError,
  clearLog,
  getLogPath,
  getLogLevel,
  setLogLevel,
  setLogLevelFromArgs,
  redactArgs,
} from './logger.js'
export {
  installCrashReporter,
  getCrashLogPath,
  logCommandError,
} from './crash-reporter/index.js'
import { setCommandArgs as setCrashReporterArgs } from './crash-reporter/index.js'
import { setLogLevelFromArgs } from './logger.js'

/**
 * Set the command args for the current invocation.
 *
 * In plugin mode, args arrive via gRPC (not process.argv). Call this early
 * in `runCommand` to feed both subsystems:
 * - **Crash reporter**: stores redacted args for crash log entries
 * - **Logger**: extracts `--log-level` to enable debug logging
 *
 * @param args - The raw command args array
 * @public
 */
export function setCommandArgs(args: string[]): void {
  setCrashReporterArgs(args)
  setLogLevelFromArgs(args)
}

// Export plugin server utilities from the embedded grpc module
// This makes bootstrap a one-stop-shop for TS-based Stripe CLI plugins
export {
  servePlugin,
  formatHandshake,
  addTypedService,
  type ServeOptions,
  type NetworkType,
  type TypedServiceImplementation,
  type PluginCommand,
  type VersionedPlugins,
  type PluginMetadata,
  type CoreCLIHelper,
  TerminalInfo,
} from './grpc/index.js'

/**
 * Base flags registered on every Stripe CLI plugin (infrastructure-level).
 * @public
 */
export type BaseFlags = {
  color?: string
  'log-level': string
}

/**
 * Config-aware flags for plugins that read the Stripe CLI config or talk to the Stripe API.
 * Plugins that need these should call {@link registerConfigFlags} after {@link getPluginYargs}.
 * @public
 */
export type ConfigFlags = {
  'api-key'?: string
  config?: string
  'device-name'?: string
  'project-name': string
}

/**
 * All global flags (base + config). Kept for backwards compatibility.
 * @public
 */
export type GlobalFlags = BaseFlags & ConfigFlags

/**
 * Register base flags (color, log-level) on a yargs instance.
 * These are universal to all plugins.
 * @public
 */
export function registerBaseFlags<T>(pluginYargs: Argv<T>): Argv<T & BaseFlags> {
  return pluginYargs
    .option('color', {
      type: 'string',
      description: 'turn on/off color output (on, off, auto)',
    })
    .option('log-level', {
      type: 'string',
      default: 'info',
      description: 'log level (debug, info, trace, warn, error)',
    })
}

/**
 * Register config-aware flags (api-key, config, device-name, project-name) on a yargs instance.
 * Use this for plugins that read the Stripe CLI config file or call the Stripe API.
 * @public
 */
export function registerConfigFlags<T>(pluginYargs: Argv<T>): Argv<T & ConfigFlags> {
  return pluginYargs
    .option('api-key', {
      type: 'string',
      description: 'Your API key to use for the command',
    })
    .option('config', {
      type: 'string',
      description: 'config file (default is $HOME/.config/stripe/config.toml)',
    })
    .option('device-name', {
      type: 'string',
      description: 'device name',
    })
    .option('project-name', {
      alias: 'p',
      type: 'string',
      default: 'default',
      description: 'the project name to read from for config',
    })
}

/**
 * Register all global flags (base + config) on a yargs instance.
 * @public
 * @deprecated Use {@link registerBaseFlags} and optionally {@link registerConfigFlags} instead.
 */
export function registerGlobalFlags<T>(pluginYargs: Argv<T>): Argv<T & GlobalFlags> {
  return registerConfigFlags(registerBaseFlags(pluginYargs))
}

/**
 * Get a yargs instance configured for a Stripe CLI plugin.
 * Only registers base flags (color, log-level). Call {@link registerConfigFlags}
 * on the result if your plugin needs config-aware flags.
 * @param pluginName - The name of the plugin (e.g., "apps", "generate")
 * @returns A yargs instance with base flags registered
 * @public
 */
export function getPluginYargs(pluginName: string): Argv<BaseFlags> {
  return registerBaseFlags(
    yargs()
      .scriptName(`stripe ${pluginName}`)
      .exitProcess(false)
      .strict()
      .help()
      .demandCommand(1, 'Please specify a command.'),
  )
}
