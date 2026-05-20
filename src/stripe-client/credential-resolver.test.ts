import { describe, it, expect, vi } from 'vitest'

import type { Profile } from '../config/config.js'

import { ProfileCredentialResolver } from './credential-resolver.js'

function mockProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    profileName: 'default',
    apiKey: '',
    getUAT: vi.fn().mockResolvedValue(null),
    getAPIKey: vi.fn().mockResolvedValue('sk_test_mock'),
    getAccountID: vi.fn().mockResolvedValue('acct_mock'),
    getLiveContext: vi.fn().mockReturnValue(null),
    getTestWorkspaceID: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as Profile
}

describe('ProfileCredentialResolver', () => {
  it('returns API key auth when no UAT is available (test mode)', async () => {
    const profile = mockProfile({
      getAPIKey: vi.fn().mockResolvedValue('sk_test_from_config'),
    })
    const resolver = new ProfileCredentialResolver(profile)

    const auth = await resolver.resolve(false)
    expect(auth).toEqual({ type: 'api-key', apiKey: 'sk_test_from_config' })
    expect(profile.getAPIKey).toHaveBeenCalledWith(false)
  })

  it('returns API key auth when no UAT is available (live mode)', async () => {
    const profile = mockProfile({
      getAPIKey: vi.fn().mockResolvedValue('sk_live_from_keychain'),
    })
    const resolver = new ProfileCredentialResolver(profile)

    const auth = await resolver.resolve(true)
    expect(auth).toEqual({ type: 'api-key', apiKey: 'sk_live_from_keychain' })
    expect(profile.getAPIKey).toHaveBeenCalledWith(true)
  })

  it('returns UAT auth with live context when UAT exists and livemode=true', async () => {
    const profile = mockProfile({
      getUAT: vi.fn().mockResolvedValue('keyinfo_live_token'),
      getAccountID: vi.fn().mockResolvedValue('acct_live_123'),
      getLiveContext: vi.fn().mockReturnValue('wksp_live_abc'),
    })
    const resolver = new ProfileCredentialResolver(profile)

    const auth = await resolver.resolve(true)
    expect(auth).toEqual({
      type: 'uat',
      token: 'keyinfo_live_token',
      context: 'wksp_live_abc',
      accountId: 'acct_live_123',
      livemode: true,
    })
  })

  it('returns UAT auth with test workspace when UAT exists and livemode=false', async () => {
    const profile = mockProfile({
      getUAT: vi.fn().mockResolvedValue('keyinfo_live_token'),
      getAccountID: vi.fn().mockResolvedValue('acct_test_456'),
      getTestWorkspaceID: vi.fn().mockReturnValue('wksp_test_sandbox_xyz'),
    })
    const resolver = new ProfileCredentialResolver(profile)

    const auth = await resolver.resolve(false)
    expect(auth).toEqual({
      type: 'uat',
      token: 'keyinfo_live_token',
      context: 'wksp_test_sandbox_xyz',
      accountId: 'acct_test_456',
      livemode: false,
    })
  })

  it('throws when UAT exists but no live context is configured', async () => {
    const profile = mockProfile({
      profileName: 'myprofile',
      getUAT: vi.fn().mockResolvedValue('keyinfo_live_token'),
      getAccountID: vi.fn().mockResolvedValue('acct_123'),
      getLiveContext: vi.fn().mockReturnValue(null),
    })
    const resolver = new ProfileCredentialResolver(profile)

    await expect(resolver.resolve(true)).rejects.toThrow(
      "No live_context configured for profile 'myprofile'",
    )
  })

  it('throws when UAT exists but no test workspace is configured', async () => {
    const profile = mockProfile({
      profileName: 'myprofile',
      getUAT: vi.fn().mockResolvedValue('keyinfo_live_token'),
      getAccountID: vi.fn().mockResolvedValue('acct_123'),
      getTestWorkspaceID: vi.fn().mockReturnValue(null),
    })
    const resolver = new ProfileCredentialResolver(profile)

    await expect(resolver.resolve(false)).rejects.toThrow(
      "No test_workspace_id configured for profile 'myprofile'",
    )
  })

  it('prefers --api-key flag over UAT', async () => {
    const profile = mockProfile({
      apiKey: 'sk_test_from_flag',
      getUAT: vi.fn().mockResolvedValue('keyinfo_live_token'),
    })
    const resolver = new ProfileCredentialResolver(profile)

    const auth = await resolver.resolve(false)
    expect(auth).toEqual({ type: 'api-key', apiKey: 'sk_test_from_flag' })
    expect(profile.getUAT).not.toHaveBeenCalled()
  })

  it('prefers STRIPE_API_KEY env var over UAT', async () => {
    const original = process.env.STRIPE_API_KEY
    try {
      process.env.STRIPE_API_KEY = 'sk_test_from_env'
      const profile = mockProfile({
        getUAT: vi.fn().mockResolvedValue('keyinfo_live_token'),
      })
      const resolver = new ProfileCredentialResolver(profile)

      const auth = await resolver.resolve(false)
      expect(auth).toEqual({ type: 'api-key', apiKey: 'sk_test_from_env' })
      expect(profile.getUAT).not.toHaveBeenCalled()
    } finally {
      if (original === undefined) {
        delete process.env.STRIPE_API_KEY
      } else {
        process.env.STRIPE_API_KEY = original
      }
    }
  })

  it('falls back to UAT when no explicit API key is set', async () => {
    const original = process.env.STRIPE_API_KEY
    try {
      delete process.env.STRIPE_API_KEY
      const profile = mockProfile({
        apiKey: '',
        getUAT: vi.fn().mockResolvedValue('keyinfo_live_token'),
        getAccountID: vi.fn().mockResolvedValue('acct_123'),
        getTestWorkspaceID: vi.fn().mockReturnValue('wksp_test_xyz'),
      })
      const resolver = new ProfileCredentialResolver(profile)

      const auth = await resolver.resolve(false)
      expect(auth).toEqual({
        type: 'uat',
        token: 'keyinfo_live_token',
        context: 'wksp_test_xyz',
        accountId: 'acct_123',
        livemode: false,
      })
    } finally {
      if (original === undefined) {
        delete process.env.STRIPE_API_KEY
      } else {
        process.env.STRIPE_API_KEY = original
      }
    }
  })
})
