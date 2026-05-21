/**
 * Credential resolution for the Stripe CLI.
 *
 * Resolves the correct authentication credential from the config/keychain
 * based on the requested mode (livemode vs test) and whether a UAT is available.
 *
 * Resolution priority:
 * 1. Explicit API key (STRIPE_API_KEY env var or --api-key flag) — produces APIKeyAuth
 * 2. UAT from keychain (if available) — produces UATAuth with the appropriate context
 * 3. API key from config file — produces APIKeyAuth
 */

import type { Profile } from '../config/config.js'
import type { StripeAuth } from './types.js'
import type { UATAuth } from './uat.js'

/**
 * Resolves authentication credentials for the StripeClient.
 *
 * Callers can provide a CredentialResolver instead of explicit auth to have
 * the client automatically read credentials from the config/keychain.
 * @public
 */
export interface CredentialResolver {
  resolve(livemode: boolean): Promise<StripeAuth>
}

/**
 * Default credential resolver that reads from the Stripe CLI Profile.
 *
 * Resolution logic:
 * - If an explicit API key is set (env var or --api-key flag), returns APIKeyAuth immediately
 * - If a UAT is stored in the keychain, returns UATAuth with the matching context
 *   (live_context for livemode, test_workspace_id for test mode)
 * - Otherwise falls back to the API key from the config file
 * @public
 */
export class ProfileCredentialResolver implements CredentialResolver {
  private readonly profile: Profile

  constructor(profile: Profile) {
    this.profile = profile
  }

  async resolve(livemode: boolean): Promise<StripeAuth> {
    const explicitKey = this.getExplicitAPIKey()
    if (explicitKey) {
      return { type: 'api-key', apiKey: explicitKey }
    }

    const uat = await this.profile.getUAT()
    if (uat) {
      return this.buildUATAuth(uat, livemode)
    }

    const apiKey = await this.profile.getAPIKey(livemode)
    return { type: 'api-key', apiKey }
  }

  private getExplicitAPIKey(): string | null {
    const envKey = process.env.STRIPE_API_KEY
    if (envKey) {
      return envKey
    }
    if (this.profile.apiKey) {
      return this.profile.apiKey
    }
    return null
  }

  private async buildUATAuth(token: string, livemode: boolean): Promise<UATAuth> {
    const accountId = await this.profile.getAccountID()
    const context = livemode
      ? this.profile.getLiveContext()
      : this.profile.getTestWorkspaceID()

    if (!context) {
      throw new Error(
        `No ${livemode ? 'live_context' : 'test_workspace_id'} configured for profile '${this.profile.profileName}'`,
      )
    }

    return {
      type: 'uat',
      token,
      context,
      accountId,
      livemode,
    }
  }
}
