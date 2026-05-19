import { TerminalInfo } from '../grpc/index.js'

/**
 * Check if the host CLI is running in a TTY terminal.
 * Uses TerminalInfo from bootstrap which receives this info from the CLI via gRPC.
 * @public
 */
export function isTTY(): boolean {
  return TerminalInfo.hostStdinIsTerminal && TerminalInfo.hostStdoutIsTerminal
}

/**
 * Require a TTY terminal, throwing an error if not available.
 * @param pluginName - Plugin name for error message hints (e.g. "generate")
 * @public
 */
export function requireTTY(pluginName: string): void {
  if (!isTTY()) {
    console.error('Interactive mode requires a TTY terminal.')
    console.error(`Use: stripe ${pluginName} <command> [options]`)
    console.error(`Or run: stripe ${pluginName} --help`)
    throw new Error('Interactive mode requires a TTY terminal.')
  }
}
