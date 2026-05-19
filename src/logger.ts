import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

let logFilePath = ''
let currentLogLevel = 'info'

/**
 * Initialize the logger: sets the plugin name (for the log file path) AND
 * extracts --log-level from args in one call.
 * Returns the detected log level, or undefined if --log-level was not found.
 *
 * @param pluginName - Plugin name used to derive the log file name (e.g. "generate" → "stripe-generate-plugin.log")
 * @param args - CLI args to scan for --log-level
 * @returns The detected log level string, or undefined
 * @public
 */
export function initLogger(pluginName: string, args: string[]): string | undefined {
  logFilePath = path.join(os.tmpdir(), `stripe-${pluginName}-plugin.log`)
  return setLogLevelFromArgs(args)
}

/**
 * Set the log level. Called early with the --log-level flag value.
 * @public
 */
export function setLogLevel(level: string): void {
  currentLogLevel = level
}

function isEnabled(): boolean {
  return currentLogLevel === 'debug'
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message
  }
  try {
    const json = JSON.stringify(value)
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}

/**
 * Simple file logger for debugging plugin issues.
 * Only writes when --log-level debug is set.
 * @public
 */
export function log(message: string, ...args: unknown[]): void {
  if (!isEnabled()) return

  try {
    const timestamp = new Date().toISOString()
    const formatted =
      args.length > 0
        ? `${message} ${args.map(a => safeStringify(a)).join(' ')}`
        : message
    const line = `[${timestamp}] ${formatted}\n`
    fs.appendFileSync(logFilePath, line, { mode: 0o600 })
  } catch {
    // Ignore write errors
  }
}

/**
 * Log an error with stack trace.
 * Only writes when --log-level debug is set.
 * @public
 */
export function logError(message: string, error: unknown): void {
  if (!isEnabled()) return

  try {
    const timestamp = new Date().toISOString()
    const errorStr = safeStringify(error)
    const line = `[${timestamp}] ERROR: ${message}\n${errorStr}\n`
    fs.appendFileSync(logFilePath, line, { mode: 0o600 })
  } catch {
    // Ignore write errors
  }
}

/**
 * Clear the log file
 * @public
 */
export function clearLog(): void {
  if (!isEnabled()) return

  try {
    fs.writeFileSync(logFilePath, '', { mode: 0o600 })
  } catch {
    // Ignore errors
  }
}

/**
 * Get the log file path
 * @public
 */
export function getLogPath(): string {
  return logFilePath
}

/**
 * Get the current log level.
 * @public
 */
export function getLogLevel(): string {
  return currentLogLevel
}

/** Flags whose values should be redacted in logs */
const SENSITIVE_FLAGS = ['--api-key', '--secret-key']

/**
 * Redact sensitive flag values from an args array for safe logging.
 * Handles both `--flag value` and `--flag=value` forms.
 * @public
 */
export function redactArgs(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    // Check --flag=value form
    const eqFlag = SENSITIVE_FLAGS.find(f => arg.startsWith(`${f}=`))
    if (eqFlag) {
      result.push(`${eqFlag}=***`)
      continue
    }

    // Check --flag value form (next arg is the value)
    if (SENSITIVE_FLAGS.includes(arg) && i + 1 < args.length) {
      result.push(arg, '***')
      i++ // skip the value
      continue
    }

    result.push(arg)
  }
  return result
}

/**
 * Extract --log-level from args and set it.
 * Returns the detected log level, or undefined if not found.
 * @public
 */
export function setLogLevelFromArgs(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    // --log-level=debug form
    if (arg.startsWith('--log-level=')) {
      const level = arg.split('=')[1]
      if (level) {
        setLogLevel(level)
        return level
      }
    }

    // --log-level debug form (two separate tokens)
    if (arg === '--log-level' && i + 1 < args.length) {
      const level = args[i + 1]
      setLogLevel(level)
      return level
    }
  }

  return undefined
}
