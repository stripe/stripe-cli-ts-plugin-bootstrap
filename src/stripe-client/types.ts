import type { Profile } from '../config/config.js'
import type { UATAuth } from './uat.js'

/**
 * Authentication via a traditional Stripe API key (sk_test_*, sk_live_*, rk_*).
 * Uses `Authorization: Bearer <apiKey>`.
 * @public
 */
export interface APIKeyAuth {
  type: 'api-key'
  apiKey: string
}

/**
 * Supported authentication methods for the StripeClient.
 * @public
 */
export type StripeAuth = APIKeyAuth | UATAuth

/**
 * Options for constructing a StripeClient.
 *
 * Authentication can be provided in two ways:
 * - `auth`: Explicit credentials — either an API key string or a structured auth object.
 * - Omit `auth`: Credentials are resolved lazily from the config/keychain on first request.
 *   Pass `profile` to override which profile is used (defaults to the global config profile).
 *   Pass `livemode` to control whether live or test credentials are fetched.
 * @public
 */
export interface StripeClientOptions {
  auth?: string | StripeAuth
  profile?: Profile
  baseURL?: string
  stripeAccount?: string
  apiVersion?: string
  userAgent?: string
  verbose?: boolean
  livemode?: boolean
}

/**
 * Options for individual requests
 * @public
 */
export interface StripeRequestOptions {
  stripeAccount?: string
  stripeContext?: string
  idempotencyKey?: string
  apiVersion?: string
  headers?: Record<string, string>
}

/**
 * Parsed response from a Stripe API request
 * @public
 */
export interface StripeResponse<T = unknown> {
  data: T
  statusCode: number
  requestId: string
  headers: Record<string, string>
}
