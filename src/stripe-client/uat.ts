/**
 * UAT (User Access Token) authentication support for the Stripe CLI.
 *
 * This module is experimental. All UAT-related logic is colocated here
 * so it can be cleanly removed if the feature is abandoned.
 *
 * UAT auth differs from API key auth in several ways:
 * - Authorization header uses `STRIPE-V2-SIG <token>` scheme
 * - Targets a workspace context via `Stripe-Context` header
 * - For dashboard endpoints (/ajax, /graphql, /manage): sends token as a cookie,
 *   uses Stripe-Account + Stripe-Livemode instead of Stripe-Context, and routes
 *   to the dashboard URL
 */

import type { StripeRequestOptions } from './types.js'

const DEFAULT_DASHBOARD_BASE_URL = 'https://dashboard.stripe.com'

/**
 * Authentication via a User Access Token (UAT).
 * Uses `Authorization: STRIPE-V2-SIG <token>`.
 *
 * A UAT targets a specific workspace context via the `Stripe-Context` header.
 * The context determines which environment the request operates in:
 * - Live workspace: `wksp_<id>`
 * - Sandbox: `wksp_test_<id>` (sandbox workspace)
 * - Legacy test mode: `wksp_test_<id>` (legacy test mode workspace)
 *
 * For dashboard endpoints (`/ajax`, `/graphql`, `/manage`), the UAT is sent as
 * a cookie (`__Host-session`) and the request uses `Stripe-Account` +
 * `Stripe-Livemode` headers instead of `Stripe-Context`.
 * @public
 */
export interface UATAuth {
  type: 'uat'
  token: string
  context: string
  accountId: string
  livemode?: boolean
}

/**
 * Returns true if the auth object is a UAT.
 * @public
 */
export function isUATAuth(auth: { type: string }): auth is UATAuth {
  return auth.type === 'uat'
}

/**
 * Resolve the effective base URL for a UAT request.
 * Dashboard paths (/ajax, /graphql, /manage) route to the dashboard; all others use the provided base.
 */
export function resolveUATBaseURL(
  path: string,
  configuredBaseURL: string,
  defaultAPIBaseURL: string,
): string {
  if (classifyPath(path) !== 'api' && configuredBaseURL === defaultAPIBaseURL) {
    return DEFAULT_DASHBOARD_BASE_URL
  }
  return configuredBaseURL
}

/**
 * Build the auth-related headers for a UAT request.
 * Returns the headers that should be merged into the request.
 */
export function buildUATHeaders(
  auth: UATAuth,
  path: string,
  options?: StripeRequestOptions,
): Record<string, string> {
  switch (classifyPath(path)) {
    case 'graphql':
      return buildGraphQLHeaders(auth, options)
    case 'dashboard':
      return buildDashboardHeaders(auth, options)
    case 'api':
      return buildAPIHeaders(auth, options)
  }
}

function buildGraphQLHeaders(
  auth: UATAuth,
  options?: StripeRequestOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: `__Host-auth_token=${auth.token}`,
    Authorization: 'STRIPE-V2-SIG',
  }

  const stripeContext = options?.stripeContext ?? auth.context
  if (stripeContext) {
    headers['Stripe-Context'] = stripeContext
  }

  return headers
}

function buildDashboardHeaders(
  auth: UATAuth,
  options?: StripeRequestOptions,
): Record<string, string> {
  const livemode = auth.livemode ?? !auth.context.startsWith('wksp_test_')
  return {
    Cookie: `__Host-session=${auth.token}`,
    'Stripe-Account': options?.stripeAccount ?? auth.accountId,
    'Stripe-Livemode': String(livemode),
  }
}

function buildAPIHeaders(
  auth: UATAuth,
  options?: StripeRequestOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `STRIPE-V2-SIG ${auth.token}`,
  }

  const stripeContext = options?.stripeContext ?? auth.context
  if (stripeContext) {
    headers['Stripe-Context'] = stripeContext
  }

  if (options?.stripeAccount) {
    headers['Stripe-Account'] = options.stripeAccount
  }

  return headers
}

/**
 * Redact sensitive UAT values from a header for verbose logging.
 * Returns the redacted value, or undefined if this header is not UAT-sensitive.
 */
export function redactUATHeaderValue(name: string, value: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower === 'authorization' && /^stripe-v2-sig\s/i.test(value)) {
    return value.replace(/^(stripe-v2-sig)\s+.+/i, '$1 [REDACTED]')
  }
  if (lower === 'cookie') {
    return value.replace(/(__Host-(?:session|auth_token)=)[^\s;]+/g, '$1[REDACTED]')
  }
  return undefined
}

type UATPathType = 'graphql' | 'dashboard' | 'api'

function classifyPath(path: string): UATPathType {
  if (path.startsWith('/graphql')) return 'graphql'
  if (path.startsWith('/ajax') || path.startsWith('/manage')) return 'dashboard'
  return 'api'
}
