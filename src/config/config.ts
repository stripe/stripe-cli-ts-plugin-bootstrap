/**
 * 1:1 Port of stripe-cli/pkg/config
 *
 * Ported from:
 * - github.com/stripe/stripe-cli@v1.16.0/pkg/config/config.go
 * - github.com/stripe/stripe-cli@v1.16.0/pkg/config/profile.go
 * - Go stripe-cli-plugin-bootstrap/pkg/config/config.go
 * - Go stripe-cli-plugin-bootstrap/pkg/config/config_dev.go
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as toml from '@iarna/toml'
import { getKeychain } from './keychain.js'
import { redactAPIKey, isRedactedAPIKey } from './redact.js'

/**
 * Devmode determines whether the plugin runs in development mode
 * Ported from: config.go / config_dev.go
 *
 * In Go, this is set via build tags:
 * - config.go (!localdev): Devmode = false
 * - config_dev.go (localdev): Devmode = true
 *
 * In TypeScript, we use NODE_ENV or a specific environment variable
 * @public
 */
export const Devmode =
  process.env.NODE_ENV === 'development' ||
  process.env.STRIPE_CLI_PLUGIN_DEVMODE === 'true'

/**
 * Config key name for account ID
 * @public
 */
export const AccountIDName = 'account_id'

/**
 * Config key name for device name
 * @public
 */
export const DeviceNameName = 'device_name'

/**
 * Config key name for display name
 * @public
 */
export const DisplayNameName = 'display_name'

/**
 * Config key name for terms acceptance validation
 * @public
 */
export const IsTermsAcceptanceValidName = 'is_terms_acceptance_valid'

/**
 * Config key name for test mode API key
 * @public
 */
export const TestModeAPIKeyName = 'test_mode_api_key'

/**
 * Config key name for live mode API key
 * @public
 */
export const LiveModeAPIKeyName = 'live_mode_api_key'

/**
 * Keychain item key for the user access token (top-level, not profile-prefixed).
 * Matches Go's UATKeychainItemKey constant.
 * @public
 */
export const UATKeychainItemKey = 'uat'

/**
 * A Stripe compartment from the OIDC userinfo response.
 * Ported from: profile.go Compartment struct
 * @public
 */
export interface Compartment {
  compartment_id: string
  compartment_type: string
  livemode: boolean
  permissions?: string[]
}

/**
 * OIDC userinfo response persisted in the profile config.
 * Ported from: profile.go UserInfo struct
 * @public
 */
export interface UserInfo {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  compartments?: Compartment[]
  inherit_user_permissions?: boolean
  permissions_updated_at?: string
}

/**
 * Color setting: on
 * @public
 */
export const ColorOn = 'on'

/**
 * Color setting: off
 * @public
 */
export const ColorOff = 'off'

/**
 * Color setting: auto
 * @public
 */
export const ColorAuto = 'auto'

/**
 * Profile handles project-specific configurations
 * Ported from: stripe-cli/pkg/config/profile.go lines 19-31
 * @public
 */
export class Profile {
  deviceName: string = ''
  profileName: string = 'default'
  apiKey: string = ''
  accountID: string = ''
  displayName: string = ''

  // Reference to parent config for file operations
  private config: Config

  constructor(config: Config, profileName: string = 'default') {
    this.config = config
    this.profileName = profileName
  }

  /**
   * GetConfigField returns the configuration field for the specific profile
   * Ported from: profile.go lines 267-269
   */
  getConfigField(field: string): string {
    return `${this.profileName}.${field}`
  }

  /**
   * GetAPIKey returns the API key for the given profile
   * Priority: STRIPE_API_KEY env var \> profile.APIKey flag \> config file
   * Ported from: profile.go lines 139-192
   */
  async getAPIKey(livemode: boolean): Promise<string> {
    // Check environment variable first
    const envKey = process.env.STRIPE_API_KEY
    if (envKey) {
      // TODO: Add validators.APIKey(envKey) validation
      return envKey
    }

    // Check if set via flag (from parsed args)
    if (this.apiKey) {
      // TODO: Add validators.APIKey validation
      return this.apiKey
    }

    // Try to fetch from configuration file
    let key = ''

    if (!livemode) {
      // Check for test mode API key in config
      // Support legacy field names: secret_key, api_key
      const configData = this.config.readConfigFile()
      if (configData && configData[this.profileName]) {
        const profileData = configData[this.profileName] as Record<string, any>
        key =
          profileData[TestModeAPIKeyName] ||
          profileData['secret_key'] ||
          profileData['api_key'] ||
          ''
      }
    } else {
      // Live mode keys are stored in keyring
      key = await this.retrieveLivemodeValue(LiveModeAPIKeyName)
    }

    if (key) {
      // TODO: Add validators.APIKey validation
      return key
    }

    throw new Error(
      'API key not configured. Please run `stripe login` or set STRIPE_API_KEY',
    )
  }

  /**
   * GetAccountID returns the account ID for the given profile
   * Ported from: profile.go lines 126-136
   */
  async getAccountID(): Promise<string> {
    // Check if set via flag (from parsed args)
    if (this.accountID) {
      return this.accountID
    }

    // Try to fetch from configuration file
    const configData = this.config.readConfigFile()
    if (configData && configData[this.profileName]) {
      const profileData = configData[this.profileName] as Record<string, any>
      const accountID = profileData[AccountIDName]
      if (accountID) {
        return accountID as string
      }
    }

    throw new Error('Account ID not configured')
  }

  /**
   * GetDeviceName returns the configured device name
   * Ported from: profile.go lines 109-123
   */
  getDeviceName(): string {
    // Check environment variable
    const envDeviceName = process.env.STRIPE_DEVICE_NAME
    if (envDeviceName) {
      return envDeviceName
    }

    // Check if set via flag
    if (this.deviceName) {
      return this.deviceName
    }

    // Try to fetch from configuration file
    const configData = this.config.readConfigFile()
    if (configData && configData[this.profileName]) {
      const profileData = configData[this.profileName] as Record<string, any>
      const deviceName = profileData[DeviceNameName]
      if (deviceName) {
        return deviceName as string
      }
    }

    // Default to hostname
    try {
      return os.hostname()
    } catch {
      return 'unknown'
    }
  }

  /**
   * GetDisplayName returns the account display name
   * Ported from: profile.go lines 249-255
   */
  getDisplayName(): string {
    const configData = this.config.readConfigFile()
    if (configData && configData[this.profileName]) {
      const profileData = configData[this.profileName] as Record<string, any>
      const displayName = profileData[DisplayNameName]
      if (displayName) {
        return displayName as string
      }
    }

    return ''
  }

  /**
   * GetUAT retrieves the user access token from the keychain.
   * The UAT is stored as a top-level keychain item (not profile-prefixed).
   * Returns null if no UAT is configured.
   * Ported from: profile.go UATKeychainItemKey + KeyRing.Get
   */
  async getUAT(): Promise<string | null> {
    try {
      const keychain = getKeychain()
      return await keychain.get(UATKeychainItemKey)
    } catch {
      return null
    }
  }

  /**
   * GetLiveContext returns the live workspace context (e.g., "acct_live_456")
   * from UserInfo.Compartments in the config file.
   * Ported from: login/keys/configurer.go — LiveContext stored as livemode compartment
   */
  getLiveContext(): string | null {
    const compartments = this.getCompartments()
    return compartments.find(c => c.livemode)?.compartment_id ?? null
  }

  /**
   * GetTestWorkspaceID returns the test workspace ID (e.g., "acct_test_789")
   * from UserInfo.Compartments in the config file.
   * Ported from: login/keys/configurer.go — TestWorkspaceID stored as non-livemode compartment
   */
  getTestWorkspaceID(): string | null {
    const compartments = this.getCompartments()
    return compartments.find(c => !c.livemode)?.compartment_id ?? null
  }

  private getCompartments(): Compartment[] {
    const configData = this.config.readConfigFile()
    if (configData) {
      const userInfo = configData['user_info'] as UserInfo | undefined
      return userInfo?.compartments ?? []
    }
    return []
  }

  /**
   * GetConfigFieldValue returns a specific config field value
   * Used for terms acceptance and other custom fields
   */
  getConfigFieldValue(fieldName: string): string {
    const configData = this.config.readConfigFile()
    if (configData && configData[this.profileName]) {
      const profileData = configData[this.profileName] as Record<string, any>
      const value = profileData[fieldName]
      if (value !== undefined) {
        return String(value)
      }
    }

    throw new Error(
      `Config field '${fieldName}' not found in profile '${this.profileName}'`,
    )
  }

  /**
   * retrieveLivemodeValue retrieves livemode value of given key in keyring
   * Ported from: profile.go retrieveLivemodeValue function
   */
  async retrieveLivemodeValue(key: string): Promise<string> {
    const fieldID = this.getConfigField(key)
    const keychain = getKeychain()

    // Get all keys to check if ours exists
    const existingKeys = await keychain.keys()

    for (const item of existingKeys) {
      if (item === fieldID) {
        const value = await keychain.get(fieldID)
        if (value !== null) {
          return value
        }
      }
    }

    throw new Error('API key not configured')
  }
}

/**
 * Config handles overall configuration for the CLI
 * Ported from: stripe-cli/pkg/config/config.go lines 44-51
 * @public
 */
export class Config {
  color: string = ColorAuto
  logLevel: string = 'info'
  profile: Profile
  profilesFile: string = ''
  installedPlugins: string[] = []

  // Cached config data to avoid repeated file reads
  private cachedConfigData: Record<string, any> | null = null

  constructor() {
    this.profile = new Profile(this, 'default')
  }

  /**
   * GetConfigFolder retrieves the folder where the profiles file is stored
   * Ported from: config.go lines 61-82
   */
  getConfigFolder(xdgPath?: string): string {
    let configPath = xdgPath || process.env.XDG_CONFIG_HOME || ''

    if (!configPath) {
      const home = os.homedir()
      configPath = path.join(home, '.config')
    }

    const stripeConfigPath = path.join(configPath, 'stripe')

    return stripeConfigPath
  }

  /**
   * InitConfig reads in profiles file and ENV variables if set
   * Ported from: config.go lines 85-169
   */
  initConfig(): void {
    // Set log level (lines 94-107)
    // TODO: Implement proper logging setup
    switch (this.logLevel) {
      case 'debug':
      case 'info':
      case 'trace':
      case 'warn':
      case 'error':
        // Log level is valid
        break
      default:
        throw new Error(
          `Unrecognized log level value: ${this.logLevel}. Expected one of debug, info, warn, error.`,
        )
    }

    // Set config file path (lines 109-125)
    if (!this.profilesFile) {
      const configFolder = this.getConfigFolder()
      this.profilesFile = path.join(configFolder, 'config.toml')

      // Try to change permissions to 0600 if file exists (lines 119-124)
      try {
        if (fs.existsSync(this.profilesFile)) {
          fs.chmodSync(this.profilesFile, 0o600)
        }
      } catch {
        // Ignore permission errors
      }
    }

    // Read config file (lines 127-133)
    this.cachedConfigData = this.readConfigFile()

    // Set device name if not already set (lines 135-142)
    if (!this.profile.deviceName) {
      try {
        this.profile.deviceName = os.hostname()
      } catch {
        this.profile.deviceName = 'unknown'
      }
    }

    // Handle color configuration (lines 144-160)
    // TODO: Implement color handling (ansi.ForceColors, etc.)
    // For now, just validate the color value
    switch (this.color) {
      case ColorOn:
      case ColorOff:
      case ColorAuto:
        // Valid color
        break
      default:
        throw new Error(
          `Unrecognized color value: ${this.color}. Expected one of on, off, auto.`,
        )
    }

    // Initialize keyring and redact livemode values (lines 162-168)
    this.redactAllLivemodeValues()
  }

  /**
   * ReadConfigFile reads and parses the TOML config file
   * Returns the parsed config data
   */
  readConfigFile(): Record<string, any> | null {
    // Return cached data if available
    if (this.cachedConfigData !== null) {
      return this.cachedConfigData
    }

    if (!this.profilesFile) {
      return null
    }

    try {
      if (!fs.existsSync(this.profilesFile)) {
        return null
      }

      const fileContents = fs.readFileSync(this.profilesFile, 'utf8')
      const parsed = toml.parse(fileContents)

      // Cache the result
      this.cachedConfigData = parsed as Record<string, any>

      return this.cachedConfigData
    } catch {
      // File doesn't exist or can't be read
      return null
    }
  }

  /**
   * WriteConfigField updates a configuration field and writes the updated
   * configuration to disk.
   * Ported from: config.go lines 280-285
   */
  writeConfigField(field: string, value: any): void {
    // Read current config
    const configData = this.readConfigFile() || {}

    // Set the field (handle nested fields like "default.account_id")
    const fieldParts = field.split('.')
    let current: any = configData

    for (let i = 0; i < fieldParts.length - 1; i++) {
      const part = fieldParts[i]
      if (!current[part]) {
        current[part] = {}
      }
      current = current[part]
    }

    // If value is undefined, delete the field
    if (value === undefined) {
      delete current[fieldParts[fieldParts.length - 1]]
    } else {
      current[fieldParts[fieldParts.length - 1]] = value
    }

    // Write back to file
    this.writeConfigFile(configData)

    // Invalidate cache
    this.cachedConfigData = null
  }

  /**
   * WriteConfigFile writes the entire config data to disk
   */
  private writeConfigFile(configData: Record<string, any>): void {
    if (!this.profilesFile) {
      throw new Error('Config file path not set')
    }

    // Ensure directory exists
    const dir = path.dirname(this.profilesFile)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
    }

    // Convert to TOML and write
    const tomlString = toml.stringify(configData as toml.JsonMap)
    fs.writeFileSync(this.profilesFile, tomlString, { mode: 0o600 })
  }

  /**
   * saveLivemodeValue saves livemode value of given key in keyring
   * and stores the redacted version in the config file
   * Ported from: profile.go saveLivemodeValue function
   *
   * @param fieldID - The full field identifier (e.g., "default.live_mode_api_key")
   * @param value - The secret value to store
   */
  async saveLivemodeValue(fieldID: string, value: string): Promise<void> {
    const keychain = getKeychain()
    // Store actual value in keychain
    await keychain.set(fieldID, value)
    // Store redacted version in config file
    this.writeConfigField(fieldID, redactAPIKey(value))
  }

  /**
   * deleteLivemodeValue deletes livemode value of given key in keyring
   * and removes the redacted version from the config file
   * Ported from: profile.go deleteLivemodeValue function
   *
   * @param fieldID - The full field identifier (e.g., "default.live_mode_api_key")
   */
  async deleteLivemodeValue(fieldID: string): Promise<void> {
    const keychain = getKeychain()

    const existingKeys = await keychain.keys()
    for (const item of existingKeys) {
      if (item === fieldID) {
        await keychain.delete(fieldID)
        break
      }
    }
    // Also remove from config file (redacted version)
    this.writeConfigField(fieldID, undefined)
  }

  /**
   * redactAllLivemodeValues checks for unredacted livemode keys in config
   * and redacts them, storing the real value in keyring
   * Ported from: profile.go redactAllLivemodeValues function
   */
  redactAllLivemodeValues(): void {
    const configData = this.readConfigFile()

    if (!configData || !configData[this.profile.profileName]) {
      return
    }

    const profileData = configData[this.profile.profileName] as Record<string, any>

    // Check if live mode API key field exists
    if (profileData[LiveModeAPIKeyName]) {
      const key = profileData[LiveModeAPIKeyName] as string

      // If empty or too short, delete it
      if (!key || key.length < 12) {
        this.writeConfigField(this.profile.getConfigField(LiveModeAPIKeyName), undefined)
        return
      }

      // If not already redacted, redact it and warn user
      if (!isRedactedAPIKey(key)) {
        console.log(`
(!) Livemode value found for the field '${LiveModeAPIKeyName}' in your config file.
Livemode values from the config file will be redacted and will not be used.`)

        this.writeConfigField(
          this.profile.getConfigField(LiveModeAPIKeyName),
          redactAPIKey(key),
        )
      }
    }
  }

  /**
   * GetInstalledPlugins returns a list of locally installed plugins
   * Ported from: config.go lines 211-215
   */
  getInstalledPlugins(): string[] {
    const configData = this.readConfigFile()
    if (configData && configData['installed_plugins']) {
      return configData['installed_plugins'] as string[]
    }
    return []
  }

  /**
   * GetProfile returns the Profile of the config
   * Ported from: config.go lines 54-56
   */
  getProfile(): Profile {
    return this.profile
  }
}

// Global config singleton (from bootstrap.go line 21)
let stripeCliConfig: Config | null = null

/**
 * GetStripeCLIConfig returns the global config singleton
 * Ported from: bootstrap.go lines 90-93
 * @public
 */
export function getStripeCLIConfig(): Config {
  if (!stripeCliConfig) {
    throw new Error('Config not initialized. Call initializeConfig() first.')
  }
  return stripeCliConfig
}

/**
 * Ensures the global config singleton is initialized.
 * If already initialized, this is a no-op. Otherwise calls initializeConfig()
 * with default settings.
 * @public
 */
export function ensureConfigInitialized(): Config {
  if (stripeCliConfig) {
    return stripeCliConfig
  }
  return initializeConfig()
}

/**
 * InitializeConfig creates and initializes the global config singleton
 * This should be called early in plugin startup
 * @public
 */
export function initializeConfig(
  profileName: string = 'default',
  apiKey?: string,
  configFile?: string,
  deviceName?: string,
  logLevel?: string,
  color?: string,
): Config {
  const config = new Config()

  // Set values from flags if provided
  if (profileName) {
    config.profile = new Profile(config, profileName)
  }
  if (apiKey) {
    config.profile.apiKey = apiKey
  }
  if (configFile) {
    config.profilesFile = configFile
  }
  if (deviceName) {
    config.profile.deviceName = deviceName
  }
  if (logLevel) {
    config.logLevel = logLevel
  }
  if (color) {
    config.color = color
  }

  // Initialize the config (reads file, sets defaults, etc.)
  config.initConfig()

  // Set as global singleton
  stripeCliConfig = config

  return config
}
