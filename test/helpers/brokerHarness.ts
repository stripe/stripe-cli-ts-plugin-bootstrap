/**
 * End-to-end test harness that simulates the Stripe CLI host's side of the
 * go-plugin v1.7.0 non-mux broker protocol.
 *
 * Usage:
 *   const harness = await BrokerHarness.start({ plugin, hostService })
 *   await harness.announceAndRun({ args: [...] })
 *   await harness.shutdown()
 */
import * as grpc from '@grpc/grpc-js'
import { servePlugin } from '../../src/grpc/index'
import { GRPCBrokerService, ConnInfo } from '../../src/grpc/proto/plugin/grpc_broker'
import { MainService, RunCommandRequest } from '../../src/grpc/proto/proto/main'
import type { PluginCommand } from '../../src/grpc/plugin_server_impl'

export interface HostServiceDef {
  /** Built service definition for grpc.Server.addService. */
  definition: grpc.ServiceDefinition
  /** Implementation object passed alongside the definition. */
  implementation: grpc.UntypedServiceImplementation
}

export interface StartOptions {
  plugin: PluginCommand
  /**
   * gRPC service the host should expose to the plugin via the broker (the
   * CoreCLIHelper in real life). Optional — if omitted the helper server is
   * still started but answers no methods, which is enough to verify the
   * broker dial succeeds.
   */
  hostService?: HostServiceDef
}

export type RunResult = { ok: true } | { ok: false; err: grpc.ServiceError }

export class BrokerHarness {
  private pluginServer: grpc.Server
  private helperServer: grpc.Server
  readonly helperAddress: string
  private client: grpc.Client
  private brokerStream: grpc.ClientDuplexStream<ConnInfo, ConnInfo>

  private constructor(args: {
    pluginServer: grpc.Server
    helperServer: grpc.Server
    helperAddress: string
    client: grpc.Client
    brokerStream: grpc.ClientDuplexStream<ConnInfo, ConnInfo>
  }) {
    this.pluginServer = args.pluginServer
    this.helperServer = args.helperServer
    this.helperAddress = args.helperAddress
    this.client = args.client
    this.brokerStream = args.brokerStream
  }

  static async start(options: StartOptions): Promise<BrokerHarness> {
    const { server: pluginServer, address: pluginAddress } = await servePlugin({
      versionedPlugins: { 1: options.plugin },
      address: '127.0.0.1:0',
    })

    const helperServer = new grpc.Server()
    if (options.hostService) {
      helperServer.addService(
        options.hostService.definition,
        options.hostService.implementation,
      )
    }
    const helperAddress = await new Promise<string>((resolve, reject) => {
      helperServer.bindAsync(
        '127.0.0.1:0',
        grpc.ServerCredentials.createInsecure(),
        (err, port) => {
          if (err) reject(err)
          else resolve(`127.0.0.1:${port}`)
        },
      )
    })

    const client = new grpc.Client(pluginAddress, grpc.credentials.createInsecure())
    const brokerStream = client.makeBidiStreamRequest(
      GRPCBrokerService.startStream.path,
      GRPCBrokerService.startStream.requestSerialize,
      GRPCBrokerService.startStream.responseDeserialize,
      new grpc.Metadata(),
    )
    // Consume and swallow — non-mux protocol means the plugin never sends
    // ConnInfo back, but we still need to drain the stream.
    brokerStream.on('data', () => {})
    brokerStream.on('error', () => {})

    return new BrokerHarness({
      pluginServer,
      helperServer,
      helperAddress,
      client,
      brokerStream,
    })
  }

  /**
   * Send a ConnInfo announcement (no knock) for the helper service. Mirrors
   * what go-plugin v1.7.0's `broker.Accept(id)` does in non-mux mode.
   */
  announce(brokerId = 1): void {
    this.brokerStream.write(
      ConnInfo.fromPartial({
        serviceId: brokerId,
        network: 'tcp',
        address: this.helperAddress,
      }),
    )
  }

  /**
   * Invoke Main.RunCommand directly. Does NOT announce — call `announce()`
   * first (or skip it to exercise the dial-timeout path).
   */
  runCommand(
    opts: { args?: string[]; coreCliHelperId?: number } = {},
  ): Promise<RunResult> {
    return new Promise<RunResult>(resolve => {
      const request: RunCommandRequest = {
        additionalInfo: undefined,
        args: opts.args ?? [],
        coreCliHelperId: opts.coreCliHelperId ?? 0,
      }
      this.client.makeUnaryRequest(
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
    })
  }

  /**
   * Convenience: announce then RunCommand with a short delay so the
   * announcement is parked by the plugin's broker before dial() is invoked.
   */
  async announceAndRun(
    opts: { args?: string[]; brokerId?: number; delayBeforeRunMs?: number } = {},
  ): Promise<RunResult> {
    const brokerId = opts.brokerId ?? 1
    this.announce(brokerId)
    await new Promise(r => setTimeout(r, opts.delayBeforeRunMs ?? 50))
    return this.runCommand({ args: opts.args, coreCliHelperId: brokerId })
  }

  async shutdown(): Promise<void> {
    try {
      this.brokerStream.end()
    } catch {
      /* ignore */
    }
    this.client.close()
    this.pluginServer.forceShutdown()
    await new Promise<void>(resolve => this.helperServer.tryShutdown(() => resolve()))
  }
}
