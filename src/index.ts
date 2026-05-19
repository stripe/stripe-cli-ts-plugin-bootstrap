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
 * Global flags available to all Stripe CLI plugin commands
 * @public
 */
export type GlobalFlags = {
  'api-key'?: string
  color?: string
  config?: string
  'device-name'?: string
  'log-level': string
  'project-name': string
}

/**
 * Register global flags on a yargs instance
 * Ported from bootstrap.go registerGlobalFlags lines 95-104
 * @public
 */
export function registerGlobalFlags<T>(pluginYargs: Argv<T>): Argv<T & GlobalFlags> {
  return pluginYargs
    .option('api-key', {
      type: 'string',
      description: 'Your API key to use for the command',
    })
    .option('color', {
      type: 'string',
      description: 'turn on/off color output (on, off, auto)',
    })
    .option('config', {
      type: 'string',
      description: 'config file (default is $HOME/.config/stripe/config.toml)',
    })
    .option('device-name', {
      type: 'string',
      description: 'device name',
    })
    .option('log-level', {
      type: 'string',
      default: 'info',
      description: 'log level (debug, info, trace, warn, error)',
    })
    .option('project-name', {
      alias: 'p',
      type: 'string',
      default: 'default',
      description: 'the project name to read from for config',
    })
}

/**
 * Get a yargs instance configured for a Stripe CLI plugin
 * @param pluginName - The name of the plugin (e.g., "apps", "generate")
 * @returns A yargs instance with global flags registered
 * @public
 */
export function getPluginYargs(pluginName: string): Argv<GlobalFlags> {
  return registerGlobalFlags(
    yargs()
      .scriptName(`stripe ${pluginName}`)
      .exitProcess(false)
      // Report an error for any command line argument given which is not registered above.
      .strict()
      .help()
      .demandCommand(1, 'Please specify a command.'),
  )
}
