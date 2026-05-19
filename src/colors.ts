/**
 * Terminal color utilities, re-exported from picocolors.
 *
 * picocolors automatically respects NO_COLOR, FORCE_COLOR, and TTY
 * detection — consumer code doesn't need conditional checks.
 *
 * @public
 *
 * @example
 * ```ts
 * import { colors } from '@stripe/stripe-cli-plugin-bootstrap'
 *
 * console.log(colors.green('success'))
 * console.log(colors.bold(colors.red('error')))
 * console.log(colors.dim('hint'))
 * ```
 */
export { default as colors } from 'picocolors'
