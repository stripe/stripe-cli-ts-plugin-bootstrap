/**
 * End-to-end repro of the "Keychain not initialized" bug.
 *
 * The Stripe CLI uses go-plugin v1.7.0 in non-mux mode. In that mode the host
 * announces broker services by sending a ConnInfo on the broker stream with
 * { service_id, network, address } and NO knock. The plugin's Dial(id) is
 * expected to wait on a per-service-id channel for that announcement to
 * arrive.
 *
 * The current TS broker does the opposite: it sends a knock and waits for an
 * acked ConnInfo. Announcements that arrive before dial() is called are
 * dropped by handleConnInfo() because pendingDials is empty. When dial() then
 * sends a knock, the CLI ignores it (it never registered a knock listener for
 * that service id in non-mux mode), so dial() times out at 5s.
 *
 * getBestEffortCoreCLIHelper() catches the dial timeout silently, the keychain
 * is never initialized, and any plugin code that calls getAPIKey(livemode=true)
 * surfaces the misleading "Keychain not initialized" error.
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { servePlugin } from '../src/grpc/index'
import { GRPCBrokerService, ConnInfo } from '../src/grpc/proto/plugin/grpc_broker'
import { MainService, RunCommandRequest } from '../src/grpc/proto/proto/main'
import { CoreCLIHelperService } from '../src/grpc/proto/proto/main'
import type { PluginCommand } from '../src/grpc/plugin_server_impl'
import type { CoreCLIHelper } from '../src/grpc/core_cli_helper_client'

function freshServerCreds() {
  return grpc.ServerCredentials.createInsecure()
}

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
    runCommand: (request: RunCommandRequest): Promise<void> =>
      new Promise((resolve, reject) => {
        client.makeUnaryRequest(
          MainService.runCommand.path,
          MainService.runCommand.requestSerialize,
          MainService.runCommand.responseDeserialize,
          request,
          new grpc.Metadata(),
          err => (err ? reject(err) : resolve()),
        )
      }),
  }
}

/**
 * Spin up a real grpc.Server that implements the CoreCLIHelper service. This
 * is what the CLI does on its end after calling AcceptAndServe on the broker.
 */
function startHostCoreCLIHelper(onEcho: (input: string) => string): Promise<{
  server: grpc.Server
  address: string
}> {
  const server = new grpc.Server()
  server.addService(
    {
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
    {
      echo: (
        call: { request: { input: string } },
        cb: grpc.sendUnaryData<{ output: string }>,
      ) => {
        cb(null, { output: onEcho(call.request.input) })
      },
    } as unknown as grpc.UntypedServiceImplementation,
  )
  return new Promise((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', freshServerCreds(), (err, port) => {
      if (err) return reject(err)
      resolve({ server, address: `127.0.0.1:${port}` })
    })
  })
}

describe('broker protocol: simulates go-plugin v1.7.0 non-mux host', () => {
  let cleanups: Array<() => void | Promise<void>> = []
  afterEach(async () => {
    const fns = cleanups
    cleanups = []
    for (const fn of fns) {
      try {
        await fn()
      } catch {
        /* ignore */
      }
    }
  })

  it('delivers a CoreCLIHelper when the host announces ConnInfo without a knock', async () => {
    let observedCoreHelper: CoreCLIHelper | undefined
    const echoes: string[] = []

    // Plugin under test
    class CapturePlugin implements PluginCommand {
      async runCommand(_args: string[], coreCLIHelper?: CoreCLIHelper): Promise<void> {
        observedCoreHelper = coreCLIHelper
        if (coreCLIHelper) {
          echoes.push(await coreCLIHelper.echo('ping'))
        }
      }
    }

    const { server: pluginServer, address: pluginAddress } = await servePlugin({
      versionedPlugins: { 1: new CapturePlugin() },
      address: '127.0.0.1:0',
    })
    cleanups.push(() => pluginServer.forceShutdown())

    // Host-side CoreCLIHelper service (this is what go-plugin's AcceptAndServe spins up)
    const helper = await startHostCoreCLIHelper(input => `echoed:${input}`)
    cleanups.push(
      () => new Promise<void>(resolve => helper.server.tryShutdown(() => resolve())),
    )

    const host = makeBrokerClient(pluginAddress)
    cleanups.push(() => host.client.close())

    // Step 1: open the broker StartStream
    const brokerStream = host.startStream()
    cleanups.push(() => {
      brokerStream.end()
    })

    // Drain any incoming ConnInfos from the plugin (we don't expect any in
    // non-mux mode, but we must consume the stream).
    brokerStream.on('data', () => {})
    brokerStream.on('error', () => {})

    // Step 2: announce the CoreCLIHelper service to the plugin. This is what
    // go-plugin's broker.Accept() does in v1.7.0 non-mux mode: a ConnInfo
    // with service_id/network/address and NO knock.
    const brokerID = 1
    const announcement = ConnInfo.fromPartial({
      serviceId: brokerID,
      network: 'tcp',
      address: helper.address,
    })
    brokerStream.write(announcement)

    // Give the announcement a moment to reach the plugin's broker.
    await new Promise(r => setTimeout(r, 50))

    // Step 3: call RunCommand with the announced broker ID.
    await host.runCommand({
      additionalInfo: undefined,
      args: ['--api-key', 'sk_test_dummy'],
      coreCliHelperId: brokerID,
    })

    // With the bug: the announcement was dropped (no pending dial), the
    // plugin's broker.dial() then sent a knock (which we ignored above),
    // dial() timed out, getBestEffortCoreCLIHelper swallowed it, the plugin
    // received `undefined` as coreCLIHelper and never echoed.
    //
    // With the fix: dial() looks up the announcement and connects, the
    // plugin gets a working CoreCLIHelper, and echo round-trips.
    expect(observedCoreHelper).toBeDefined()
    expect(echoes).toEqual(['echoed:ping'])
  }, 15_000)
})
