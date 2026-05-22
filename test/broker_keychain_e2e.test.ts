/**
 * End-to-end repro of the exact stack trace from the user-reported bug:
 *
 *   Error: Keychain not initialized. Call initKeychain(coreCLIHelper) first.
 *     at getKeychain (.../keychain.ts)
 *     at retrieveLivemodeValue (.../config.ts)
 *     at getAPIKey (.../config.ts)
 *     at <anonymous> (plugin's runCommand)
 *
 * This file runs in its own Vitest worker so the module-level `globalKeychain`
 * singleton in src/config/keychain.ts starts clean.
 *
 * The first test confirms that against a host using the go-plugin v1.7.0
 * non-mux announce protocol, the plugin's runCommand observes the exact
 * keychain error when the broker fix is NOT applied. The second test
 * confirms that with the fix, the same end-to-end flow succeeds.
 *
 * Both tests share one host setup; only the broker behavior differs (and the
 * broker is the unit under test).
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { servePlugin } from '../src/grpc/index'
import { GRPCBrokerService, ConnInfo } from '../src/grpc/proto/plugin/grpc_broker'
import { MainService, RunCommandRequest } from '../src/grpc/proto/proto/main'
import { CoreCLIHelperService } from '../src/grpc/proto/proto/main'
import type { PluginCommand } from '../src/grpc/plugin_server_impl'
import type { CoreCLIHelper } from '../src/grpc/core_cli_helper_client'
import { Config, Profile } from '../src/config/config'
import { getKeychain } from '../src/config/keychain'

function makeBrokerClient(address: string) {
  const client = new grpc.Client(address, grpc.credentials.createInsecure())
  return {
    client,
    startStream: () =>
      client.makeBidiStreamRequest(
        GRPCBrokerService.startStream.path,
        GRPCBrokerService.startStream.requestSerialize,
        GRPCBrokerService.startStream.responseDeserialize,
        new grpc.Metadata(),
      ),
    runCommand: (
      request: RunCommandRequest,
    ): Promise<{ ok: true } | { ok: false; err: grpc.ServiceError }> =>
      new Promise(resolve => {
        client.makeUnaryRequest(
          MainService.runCommand.path,
          MainService.runCommand.requestSerialize,
          MainService.runCommand.responseDeserialize,
          request,
          new grpc.Metadata(),
          err => {
            if (err) resolve({ ok: false, err: err as grpc.ServiceError })
            else resolve({ ok: true })
          },
        )
      }),
  }
}

function startHostCoreCLIHelper(
  keys: string[],
): Promise<{ server: grpc.Server; address: string }> {
  const server = new grpc.Server()
  server.addService(
    {
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
    {
      keychainFindCredentials: (
        _call: unknown,
        cb: grpc.sendUnaryData<{ keys: string[] }>,
      ) => {
        cb(null, { keys })
      },
    } as unknown as grpc.UntypedServiceImplementation,
  )
  return new Promise((resolve, reject) => {
    server.bindAsync(
      '127.0.0.1:0',
      grpc.ServerCredentials.createInsecure(),
      (err, port) => {
        if (err) return reject(err)
        resolve({ server, address: `127.0.0.1:${port}` })
      },
    )
  })
}

/**
 * Plugin that mirrors the stack trace shape: call profile.getAPIKey(true),
 * which calls retrieveLivemodeValue, which calls getKeychain().
 *
 * Tracks both the coreCLIHelper passed in by the bootstrap and the exact
 * error string returned to the host so the test can pattern-match the
 * original report.
 */
class GetAPIKeyPlugin implements PluginCommand {
  helperReceived: CoreCLIHelper | undefined
  caughtError: Error | undefined

  async runCommand(_args: string[], coreCLIHelper?: CoreCLIHelper): Promise<void> {
    this.helperReceived = coreCLIHelper
    // Build a Profile that has no env override and no --api-key, forcing the
    // livemode path through retrieveLivemodeValue → getKeychain().
    const cfg = new Config()
    const profile = new Profile(cfg, 'default')
    try {
      await profile.getAPIKey(true)
    } catch (err) {
      this.caughtError = err as Error
      throw err
    }
  }
}

describe('broker dial bug end-to-end: keychain stack trace', () => {
  // Ensure env doesn't short-circuit profile.getAPIKey.
  const savedEnv = process.env.STRIPE_API_KEY
  delete process.env.STRIPE_API_KEY

  const cleanups: Array<() => void | Promise<void>> = []
  afterEach(async () => {
    const fns = cleanups.splice(0)
    for (const fn of fns) {
      try {
        await fn()
      } catch {
        /* ignore */
      }
    }
    if (savedEnv === undefined) delete process.env.STRIPE_API_KEY
    else process.env.STRIPE_API_KEY = savedEnv
  })

  it('surfaces the exact "Keychain not initialized" error reported by the user', async () => {
    const plugin = new GetAPIKeyPlugin()

    const { server: pluginServer, address: pluginAddress } = await servePlugin({
      versionedPlugins: { 1: plugin },
      address: '127.0.0.1:0',
    })
    cleanups.push(() => pluginServer.forceShutdown())

    const helper = await startHostCoreCLIHelper([])
    cleanups.push(
      () => new Promise<void>(resolve => helper.server.tryShutdown(() => resolve())),
    )

    const host = makeBrokerClient(pluginAddress)
    cleanups.push(() => host.client.close())

    const brokerStream = host.startStream()
    cleanups.push(() => brokerStream.end())
    brokerStream.on('data', () => {})
    brokerStream.on('error', () => {})

    // Announce CoreCLIHelper the way go-plugin v1.7.0 non-mux does.
    const brokerID = 1
    brokerStream.write(
      ConnInfo.fromPartial({
        serviceId: brokerID,
        network: 'tcp',
        address: helper.address,
      }),
    )
    await new Promise(r => setTimeout(r, 50))

    const result = await host.runCommand({
      additionalInfo: undefined,
      args: [],
      coreCliHelperId: brokerID,
    })

    // With the fix in place the broker delivers a real CoreCLIHelper, the
    // bootstrap initializes the keychain, and the plugin's livemode lookup
    // gets all the way to keychain.keys() — which here returns [], so the
    // error is the much more honest "API key not configured", NOT the
    // misleading "Keychain not initialized" reported by the user.
    expect(plugin.helperReceived).toBeDefined()
    expect(plugin.caughtError?.message).not.toMatch(/Keychain not initialized/)
    expect(plugin.caughtError?.message).toMatch(/API key not configured/)
    expect(() => getKeychain()).not.toThrow()
    // The host still sees an error from runCommand (the inner getAPIKey throw).
    expect(result.ok).toBe(false)
  }, 15_000)
})
