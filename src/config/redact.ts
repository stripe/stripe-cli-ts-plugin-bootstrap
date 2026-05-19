/**
 * API key redaction utilities
 *
 * Ported from: stripe-cli/pkg/config/profile.go
 */

/**
 * RedactAPIKey returns a redacted version of API keys.
 * The first 8 and last 4 characters are not redacted,
 * everything else is replaced by "*" characters.
 *
 * Throws if the provided string has less than 12 characters.
 *
 * Ported from: profile.go RedactAPIKey function
 *
 * @param apiKey - The API key to redact
 * @returns The redacted API key
 * @throws Error if apiKey is less than 12 characters
 * @public
 */
export function redactAPIKey(apiKey: string): string {
  if (apiKey.length < 12) {
    throw new Error('API key must be at least 12 characters to redact')
  }

  const first8 = apiKey.substring(0, 8)
  const last4 = apiKey.substring(apiKey.length - 4)
  const middleLength = apiKey.length - 12
  const middle = '*'.repeat(middleLength)

  return first8 + middle + last4
}

/**
 * isRedactedAPIKey checks if the input string is a redacted API key
 *
 * Ported from: profile.go isRedactedAPIKey function
 *
 * @param apiKey - The string to check
 * @returns true if the string appears to be a redacted API key
 * @public
 */
export function isRedactedAPIKey(apiKey: string): boolean {
  // Check minimum length
  if (apiKey.length < 12) {
    return false
  }

  // Split on underscore to check prefix
  const keyParts = apiKey.split('_')
  if (keyParts.length < 3) {
    return false
  }

  // Must be sk_ or rk_ prefix
  if (keyParts[0] !== 'sk' && keyParts[0] !== 'rk') {
    return false
  }

  // If redacting it again would change it, it's not already redacted
  if (redactAPIKey(apiKey) !== apiKey) {
    return false
  }

  return true
}
