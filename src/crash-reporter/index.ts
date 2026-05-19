import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { redactArgs } from '../logger.js'

const MAX_CRASH_LOG_BYTES = 512 * 1024 // 512 KB

let handlersRegistered = false
let crashLogPath = ''
let activePluginName = ''
let activePluginVersion: string | undefined
let activeCommandArgs: string[] | undefined

/**
 * Returns the directory for Stripe CLI logs: `~/.config/stripe/logs/`.
 * Respects `XDG_CONFIG_HOME` if set.
 */
function getLogsDir(): string {
  const configBase = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configBase, 'stripe', 'logs')
}

/**
 * Sanitize a plugin name for safe use in file paths.
 * Strips path separators, `..`, and other characters that could escape the logs directory.
 */
function sanitizePluginName(name: string): string {
  return name.replace(/[/\\:]/g, '_').replace(/\.\./g, '_')
}

/**
 * Truncate the crash log file if it exceeds {@link MAX_CRASH_LOG_BYTES}.
 * Keeps the tail of the file (most recent entries).
 */
function truncateIfNeeded(filePath: string): void {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_CRASH_LOG_BYTES) {
      const content = fs.readFileSync(filePath, 'utf-8')
      // Keep the last ~half of max size so there's room for the new entry
      const trimmed = content.slice(-(MAX_CRASH_LOG_BYTES / 2))
      // Find the first complete entry boundary (blank line)
      const firstEntry = trimmed.indexOf('\n[')
      const clean = firstEntry > 0 ? trimmed.slice(firstEntry + 1) : trimmed
      fs.writeFileSync(filePath, clean, { mode: 0o600 })
    }
  } catch {
    // File may not exist yet — that's fine
  }
}

/**
 * Format a crash entry for the log file.
 */
function formatCrashEntry(
  label: string,
  error: unknown,
  pluginName: string,
  pluginVersion?: string,
): string {
  const timestamp = new Date().toISOString()
  const errorStr = error instanceof Error ? (error.stack ?? error.message) : String(error)

  const pluginInfo = pluginVersion ? `${pluginName} v${pluginVersion}` : pluginName
  const nodeVersion = process.version
  const args = (activeCommandArgs ?? redactArgs(process.argv.slice(2))).join(' ')

  return (
    `[${timestamp}] ${label}\n` +
    `${errorStr}\n` +
    `Plugin: ${pluginInfo} | Node: ${nodeVersion}\n` +
    `Args: ${args}\n\n`
  )
}

/**
 * Append a formatted crash entry to the log file.
 * Handles directory creation, truncation, and atomic append.
 */
function appendCrashEntry(label: string, error: unknown): void {
  if (!crashLogPath) return
  try {
    const logsDir = getLogsDir()
    fs.mkdirSync(logsDir, { recursive: true })
    truncateIfNeeded(crashLogPath)

    const entry = formatCrashEntry(label, error, activePluginName, activePluginVersion)
    fs.appendFileSync(crashLogPath, entry, { mode: 0o600 })
  } catch {
    // If we can't write the crash log, there's nothing we can do
  }
}

/**
 * Write a crash entry to the log file and emit a stderr hint.
 * Used by the uncaughtException/unhandledRejection handlers.
 */
function writeCrashLog(label: string, error: unknown): void {
  appendCrashEntry(label, error)

  // Best-effort stderr hint — may or may not reach the CLI depending on
  // whether GRPCStdio is still connected
  try {
    process.stderr.write(
      `\nPlugin crashed unexpectedly. Diagnostic information written to:\n  ${crashLogPath}\n`,
    )
  } catch {
    // Ignore
  }
}

/**
 * Store the command args for crash reporting.
 * In plugin mode, args arrive via gRPC (not process.argv), so the plugin server
 * must call this to make the real args available in crash logs.
 *
 * Args are redacted before storage (sensitive flags like --api-key are masked).
 *
 * @param args - The raw command args array
 * @public
 */
export function setCommandArgs(args: string[]): void {
  activeCommandArgs = redactArgs(args)
}

/**
 * Log a handled command error to the crash log for diagnostics.
 *
 * Unlike uncaught exceptions, these errors are caught by the plugin server and
 * returned to the CLI host via gRPC. This function writes the full stack trace
 * to the crash log so there's a local diagnostic record, without emitting a
 * "crashed unexpectedly" stderr hint (since the plugin is still running).
 *
 * No-ops if {@link installCrashReporter} has not been called.
 *
 * @param error - The error thrown by the command handler
 * @public
 */
export function logCommandError(error: unknown): void {
  appendCrashEntry('COMMAND ERROR', error)
}

/**
 * Install global crash handlers that write diagnostic information to a crash log file.
 *
 * This function is **idempotent** — calling it multiple times is safe and only registers
 * handlers once. It is called automatically by {@link servePlugin}, but plugins can call
 * it earlier (e.g. at the top of `main.ts`) to cover crashes that happen before
 * `servePlugin()` is reached.
 *
 * @param pluginName - Plugin name used to derive the crash log file name
 *   (e.g. `"generate"` → `~/.config/stripe/logs/generate-crash.log`)
 * @param pluginVersion - Optional plugin version string included in crash entries
 *
 * @public
 */
export function installCrashReporter(pluginName: string, pluginVersion?: string): void {
  const safeName = sanitizePluginName(pluginName)
  activePluginName = safeName
  activePluginVersion = pluginVersion
  crashLogPath = path.join(getLogsDir(), `${safeName}-crash.log`)

  // Eagerly create the logs directory so that both writeCrashLog() and
  // process.report have a valid target from the start.
  try {
    fs.mkdirSync(getLogsDir(), { recursive: true })
  } catch {
    // Best-effort — directory creation may fail in sandboxed environments
  }

  // Register process handlers exactly once. The handlers read from
  // module-level activePluginName/activePluginVersion, so subsequent
  // calls to installCrashReporter() update the metadata they use
  // without re-registering.
  if (!handlersRegistered) {
    handlersRegistered = true

    process.on('uncaughtException', (err: Error) => {
      writeCrashLog('UNCAUGHT EXCEPTION', err)
      process.exit(1)
    })

    process.on('unhandledRejection', (reason: unknown) => {
      writeCrashLog('UNHANDLED REJECTION', reason)
      process.exit(1)
    })
  }

  // Enable Node.js diagnostic reports for native crashes (SIGABRT, V8 fatal errors)
  // if the runtime supports it. Best-effort — Bun may not expose process.report.
  if (process.report) {
    try {
      process.report.reportOnFatalError = true
      process.report.reportOnSignal = true
      process.report.directory = getLogsDir()
    } catch {
      // process.report exists but is read-only or unsupported — ignore
    }
  }
}

/**
 * Returns the path to the crash log file, or an empty string if
 * {@link installCrashReporter} has not been called yet.
 * @public
 */
export function getCrashLogPath(): string {
  return crashLogPath
}

/** @internal — exposed for testing only */
export function _resetForTesting(): void {
  handlersRegistered = false
  crashLogPath = ''
  activePluginName = ''
  activePluginVersion = undefined
  activeCommandArgs = undefined
}
