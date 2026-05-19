/**
 * Keychain abstraction layer
 *
 * Delegates keychain operations to the Stripe CLI host via CoreCLIHelper RPCs.
 * The CLI host accesses the system keychain using the same service name as stripe-cli.
 *
 * Uses the same service name and key format as stripe-cli for compatibility.
 */

import type { CoreCLIHelper } from '../grpc/core_cli_helper_client.js'

/**
 * KeychainItem represents a single entry in the keychain
 * @public
 */
export interface KeychainItem {
  /** The unique key/identifier for this item */
  key: string
  /** The secret value to store */
  value: string
}

/**
 * Keychain provides secure storage for sensitive values like API keys
 *
 * Delegates all operations to the Stripe CLI host via CoreCLIHelper RPCs.
 *
 * @public
 */
export class Keychain {
  private helper: CoreCLIHelper

  constructor(helper: CoreCLIHelper) {
    this.helper = helper
  }

  /**
   * Store a value in the keychain
   *
   * @param key - The unique identifier for this value (e.g., "default.live_mode_api_key")
   * @param value - The secret value to store
   */
  async set(key: string, value: string): Promise<void> {
    await this.helper.keychainSetPassword(key, value)
  }

  /**
   * Retrieve a value from the keychain
   *
   * @param key - The unique identifier for the value
   * @returns The stored value, or null if not found
   */
  async get(key: string): Promise<string | null> {
    return await this.helper.keychainGetPassword(key)
  }

  /**
   * Delete a value from the keychain
   *
   * @param key - The unique identifier for the value to delete
   * @returns true if the value was deleted, false if it didn't exist
   */
  async delete(key: string): Promise<boolean> {
    return await this.helper.keychainDeletePassword(key)
  }

  /**
   * Get all keys stored for this service
   *
   * @returns Array of key identifiers
   */
  async keys(): Promise<string[]> {
    return await this.helper.keychainFindCredentials()
  }
}

/**
 * Global keychain instance
 * @internal
 */
let globalKeychain: Keychain | null = null

/**
 * Initialize the global keychain instance with a CoreCLIHelper.
 * Must be called before getKeychain() is used.
 *
 * @param helper - The CoreCLIHelper to use for keychain operations
 * @public
 */
export function initKeychain(helper: CoreCLIHelper): Keychain {
  globalKeychain = new Keychain(helper)
  return globalKeychain
}

/**
 * Get the global keychain instance.
 * initKeychain() must have been called first.
 *
 * Throws if CoreCLIHelper was unavailable (e.g. broker dial failed or older CLI
 * version). Use getOptionalKeychain() instead if keychain access is optional.
 *
 * @returns The global Keychain instance
 * @public
 */
export function getKeychain(): Keychain {
  if (!globalKeychain) {
    throw new Error('Keychain not initialized. Call initKeychain(coreCLIHelper) first.')
  }
  return globalKeychain
}

/**
 * Get the global keychain instance, or null if it was not initialized.
 *
 * Use this when keychain access is best-effort — e.g. when the plugin should
 * continue working even if the CoreCLIHelper broker dial failed.
 *
 * @returns The global Keychain instance, or null if unavailable
 * @public
 */
export function getOptionalKeychain(): Keychain | null {
  return globalKeychain
}
