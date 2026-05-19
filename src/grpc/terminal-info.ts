/**
 * Terminal information passed from the host CLI to the plugin.
 *
 * This is used to determine if the host's stdin/stdout/stderr are connected to a terminal,
 * which affects whether ANSI color codes, interactive prompts, and other terminal features
 * should be used.
 *
 * TODO: Add full ANSI color support for non-terminal outputs
 * See: https://github.com/stripe/stripe-cli/blob/master/pkg/ansi/ansi.go
 * This should include:
 * - shouldUseColors() logic with CLICOLOR/CLICOLOR_FORCE environment variable support
 * - Color/styling helpers (Bold, Faint, Green, Red, etc.)
 * - Spinner helpers for terminal vs non-terminal output
 * - ColorizeStatus for HTTP status codes
 *
 * @public
 */
export const TerminalInfo = {
  hostStdinIsTerminal: true,
  hostStdoutIsTerminal: true,
  hostStderrIsTerminal: true,
  dimensions: {
    width: 0,
    height: 0,
  },
}
