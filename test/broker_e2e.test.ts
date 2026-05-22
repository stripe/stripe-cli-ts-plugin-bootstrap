/**
 * End-to-end tests for the broker dial protocol, exercised against a real
 * grpc.Server via servePlugin and a host actor that follows the go-plugin
 * v1.7.0 non-mux protocol (announce-then-RunCommand, no knocks).
 *
 * Two scenarios:
 *   1. CoreCLIHelper round-trip: assert the broker delivers a working client
 *      and the plugin can call a host RPC (echo).
 *   2. Keychain stack trace: reproduce the failure chain the user reported
 *      (getKeychain → retrieveLivemodeValue → getAPIKey) and assert the
 *      misleading "Keychain not initialized" error is gone with the fix.
 *
 * This file resets the keychain singleton in beforeEach so it doesn't rely
 * on Vitest file-isolation to keep test state clean.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { BrokerHarness, type HostServiceDef } from './helpers/brokerHarness'
import { CoreCLIHelperService } from '../src/grpc/proto/proto/main'
import type { PluginCommand } from '../src/grpc/plugin_server_impl'
import type { CoreCLIHelper } from '../src/grpc/core_cli_helper_client'
import { Config, Profile } from '../src/config/config'
import { getKeychain, resetKeychainForTests } from '../src/config/keychain'

function echoService(onEcho: (input: string) => string): HostServiceDef {
  return {
    definition: {
      echo: {
        path: CoreCLIHelperService.echo.path,
        requestStream: false,
        responseStream: false,
        requestSerialize: CoreCLIHelperService.echo.requestSerialize,
        responseSerialize: CoreCLIHelperService.echo.responseSerialize,
        requestDeserialize: CoreCLIHelperService.echo.requestDeserialize,
        responseDeserialize: CoreCLIHelperService.echo.responseDeserialize,
        originalName: 'Echo',
      },
    } as unknown as grpc.ServiceDefinition,
    implementation: {
      echo: (
        call: { request: { input: string } },
        cb: grpc.sendUnaryData<{ output: string }>,
      ) => {
        cb(null, { output: onEcho(call.request.input) })
      },
    } as unknown as grpc.UntypedServiceImplementation,
  }
}

function keychainFindService(keys: string[]): HostServiceDef {
  return {
    definition: {
      keychainFindCredentials: {
        path: CoreCLIHelperService.keychainFindCredentials.path,
        requestStream: false,
        responseStream: false,
        requestSerialize: CoreCLIHelperService.keychainFindCredentials.requestSerialize,
        responseSerialize: CoreCLIHelperService.keychainFindCredentials.responseSerialize,
        requestDeserialize:
          CoreCLIHelperService.keychainFindCredentials.requestDeserialize,
        responseDeserialize:
          CoreCLIHelperService.keychainFindCredentials.responseDeserialize,
        originalName: 'KeychainFindCredentials',
      },
    } as unknown as grpc.ServiceDefinition,
    implementation: {
      keychainFindCredentials: (
        _call: unknown,
        cb: grpc.sendUnaryData<{ keys: string[] }>,
      ) => {
        cb(null, { keys })
      },
    } as unknown as grpc.UntypedServiceImplementation,
  }
}

describe('broker dial: end-to-end against go-plugin v1.7.0 non-mux host', () => {
  let harness: BrokerHarness | undefined
  const savedEnv = process.env.STRIPE_API_KEY

  beforeEach(() => {
    delete process.env.STRIPE_API_KEY
    resetKeychainForTests()
  })

  afterEach(async () => {
    if (harness) {
      await harness.shutdown()
      harness = undefined
    }
    if (savedEnv === undefined) delete process.env.STRIPE_API_KEY
    else process.env.STRIPE_API_KEY = savedEnv
    resetKeychainForTests()
  })

  it('delivers a working CoreCLIHelper to the plugin (announce-then-RunCommand)', async () => {
    let observed: CoreCLIHelper | undefined
    const echoes: string[] = []

    class EchoPlugin implements PluginCommand {
      async runCommand(_args: string[], coreCLIHelper?: CoreCLIHelper): Promise<void> {
        observed = coreCLIHelper
        if (coreCLIHelper) echoes.push(await coreCLIHelper.echo('ping'))
      }
    }

    harness = await BrokerHarness.start({
      plugin: new EchoPlugin(),
      hostService: echoService(s => `echoed:${s}`),
    })
    const result = await harness.announceAndRun()

    expect(result).toEqual({ ok: true })
    expect(observed).toBeDefined()
    expect(echoes).toEqual(['echoed:ping'])
  }, 15_000)

  it('replaces the misleading "Keychain not initialized" error with a real one', async () => {
    // Mirror the user-reported stack: getAPIKey(true) → retrieveLivemodeValue
    // → keychain.keys() → host stub (returns []). With the broker fix the
    // keychain is wired up and the surfaced error becomes the honest
    // "API key not configured"; pre-fix this code path threw the misleading
    // "Keychain not initialized" message.
    let helperReceived: CoreCLIHelper | undefined
    let caughtError: Error | undefined

    class GetAPIKeyPlugin implements PluginCommand {
      async runCommand(_args: string[], coreCLIHelper?: CoreCLIHelper): Promise<void> {
        helperReceived = coreCLIHelper
        const profile = new Profile(new Config(), 'default')
        try {
          await profile.getAPIKey(true)
        } catch (err) {
          caughtError = err as Error
          throw err
        }
      }
    }

    harness = await BrokerHarness.start({
      plugin: new GetAPIKeyPlugin(),
      hostService: keychainFindService([]),
    })
    const result = await harness.announceAndRun()

    expect(helperReceived).toBeDefined()
    expect(caughtError?.message).not.toMatch(/Keychain not initialized/)
    expect(caughtError?.message).toMatch(/API key not configured/)
    expect(() => getKeychain()).not.toThrow()
    expect(result.ok).toBe(false)
  }, 15_000)

  it('surfaces the broker dial failure cause via getKeychain when the host never announces', async () => {
    // No host announcement → broker dial times out → getBestEffortCoreCLIHelper
    // catches and calls setKeychainInitFailure. Plugins that then call
    // getKeychain() see the actual cause instead of the generic message.
    let helperReceived: CoreCLIHelper | undefined
    let keychainError: Error | undefined

    class KeychainCallerPlugin implements PluginCommand {
      async runCommand(_args: string[], coreCLIHelper?: CoreCLIHelper): Promise<void> {
        helperReceived = coreCLIHelper
        try {
          getKeychain()
        } catch (err) {
          keychainError = err as Error
          throw err
        }
      }
    }

    harness = await BrokerHarness.start({ plugin: new KeychainCallerPlugin() })

    // Call RunCommand without announcing — the broker dial will time out at
    // 5s, the catch in getBestEffortCoreCLIHelper records the cause, and
    // the plugin's getKeychain() call surfaces it.
    const result = await harness.runCommand({ coreCliHelperId: 42 })

    expect(helperReceived).toBeUndefined()
    expect(keychainError?.message).toMatch(
      /Keychain unavailable: Dial timeout for service 42/,
    )
    expect(result.ok).toBe(false)
  }, 15_000)
})
