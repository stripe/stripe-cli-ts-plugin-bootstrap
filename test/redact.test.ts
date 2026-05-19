/**
 * Tests for API key redaction utilities
 */

import { describe, it, expect } from 'vitest'
import { redactAPIKey, isRedactedAPIKey } from '../src/config/redact'

describe('redactAPIKey', () => {
  it('should redact API key with first 8 and last 4 characters visible', () => {
    const apiKey = 'sk_test_1234567890abcdefghijklmnop'
    const redacted = redactAPIKey(apiKey)

    // First 8 characters should be visible
    expect(redacted.substring(0, 8)).toBe('sk_test_')

    // Last 4 characters should be visible
    expect(redacted.substring(redacted.length - 4)).toBe('mnop')

    // Middle should be asterisks
    const middleLength = apiKey.length - 12
    const expectedMiddle = '*'.repeat(middleLength)
    expect(redacted.substring(8, 8 + middleLength)).toBe(expectedMiddle)
  })

  it('should throw error for API keys shorter than 12 characters', () => {
    expect(() => redactAPIKey('short')).toThrow('API key must be at least 12 characters')
  })

  it('should handle exactly 12 character keys', () => {
    const apiKey = 'sk_test_abcd'
    const redacted = redactAPIKey(apiKey)
    expect(redacted).toBe('sk_test_abcd') // No middle section
  })

  it('should redact live mode keys', () => {
    const apiKey = 'sk_live_1234567890abcdefghijklmnop'
    const redacted = redactAPIKey(apiKey)

    expect(redacted.substring(0, 8)).toBe('sk_live_')
    expect(redacted.substring(redacted.length - 4)).toBe('mnop')
  })

  it('should redact restricted keys', () => {
    const apiKey = 'rk_test_1234567890abcdefghijklmnop'
    const redacted = redactAPIKey(apiKey)

    expect(redacted.substring(0, 8)).toBe('rk_test_')
    expect(redacted.substring(redacted.length - 4)).toBe('mnop')
  })
})

describe('isRedactedAPIKey', () => {
  it('should return true for redacted sk_ keys', () => {
    const apiKey = 'sk_test_1234567890abcdefghijklmnop'
    const redacted = redactAPIKey(apiKey)
    expect(isRedactedAPIKey(redacted)).toBe(true)
  })

  it('should return true for redacted rk_ keys', () => {
    const apiKey = 'rk_test_1234567890abcdefghijklmnop'
    const redacted = redactAPIKey(apiKey)
    expect(isRedactedAPIKey(redacted)).toBe(true)
  })

  it('should return false for unredacted keys', () => {
    const apiKey = 'sk_test_1234567890abcdefghijklmnop'
    expect(isRedactedAPIKey(apiKey)).toBe(false)
  })

  it('should return false for keys without underscore separators', () => {
    expect(isRedactedAPIKey('sktest1234567890')).toBe(false)
  })

  it('should return false for keys with wrong prefix', () => {
    const apiKey = 'pk_test_1234567890abcdefghijklmnop'
    const redacted = redactAPIKey(apiKey)
    expect(isRedactedAPIKey(redacted)).toBe(false)
  })

  it('should return false for keys shorter than 12 characters', () => {
    expect(isRedactedAPIKey('sk_test_ab')).toBe(false)
  })

  it('should return false for keys without enough underscore parts', () => {
    expect(isRedactedAPIKey('sk_1234567890ab')).toBe(false)
  })
})
