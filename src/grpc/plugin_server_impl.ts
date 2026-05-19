import * as util from 'node:util'
import { GRPCControllerServer } from './proto/plugin/grpc_controller.js'
import {
  GRPCStdioServer,
  StdioData,
  StdioData_Channel,
} from './proto/plugin/grpc_stdio.js'
import {
  AdditionalInfo,
  MainServer,
  RunCommandRequest,
  RunCommandResponse,
} from './proto/proto/main.js'
import { Empty } from './proto/google/protobuf/empty.js'
import { handleServerStreamingCall, handleUnaryCall } from '@grpc/grpc-js'
import { TypedServiceImplementation } from './server.js'
import { TerminalInfo } from './terminal-info.js'
import { CoreCLIHelper, CoreCLIHelperClient } from './core_cli_helper_client.js'
import { GRPCBroker } from './grpc_broker.js'
import { initKeychain } from '../config/keychain.js'
import { setCommandArgs, logCommandError } from '../crash-reporter/index.js'

/**
 * Plugin metadata for telemetry and analytics.
 *
 * @public
 */
export interface PluginMetadata {
  /** Plugin name (e.g., "generate", "apps") */
  name: string
  /** Plugin version (e.g., "0.0.1") */
  version: string
}

/**
 * Interface that a plugin must implement to handle commands invoked by the host.
 *
 * @public
 */
export interface PluginCommand {
  runCommand(args: string[], coreCLIHelper?: CoreCLIHelper): Promise<void>
}

interface QueuedWrite {
  channel: number
  data: Buffer
  cb?: (err?: Error | null) => void
}

export class PluginServerImpl
  implements
    TypedServiceImplementation<GRPCControllerServer>,
    TypedServiceImplementation<GRPCStdioServer>,
    TypedServiceImplementation<MainServer>
{
  private _signalShutdown: () => void
  private _plugin: PluginCommand
  private _writeQueue: QueuedWrite[]
  private _broker: GRPCBroker
  private _pluginMetadata?: PluginMetadata

  constructor(
    signalShutdown: () => void,
    plugin: PluginCommand,
    broker: GRPCBroker,
    pluginMetadata?: PluginMetadata,
  ) {
    this._signalShutdown = signalShutdown
    this._plugin = plugin
    this._broker = broker
    this._pluginMetadata = pluginMetadata
    this._writeQueue = []
  }

  /**
   * Wait for all pending writes to the gRPC stream to complete.
   * This should be called before completing the command to ensure all output is sent.
   */
  async waitForFlush(): Promise<void> {
    // if (this._pendingWrites.size > 0) {
    // await Promise.all(Array.from(this._pendingWrites))
    return await new Promise((resolve, reject) => {
      if (this._writeQueue.length === 0) {
        resolve()
      } else {
        setTimeout(() => {
          this.waitForFlush().then(resolve, reject)
        }, 100)
      }
    })
  }

  runCommand: handleUnaryCall<RunCommandRequest, RunCommandResponse> = (
    call,
    callback,
  ): void => {
    const request = call.request
    setCommandArgs(request.args)
    this.applyAdditionalInfo(request.additionalInfo)

    const coreCLIHelperPromise = this.getBestEffortCoreCLIHelper(request.coreCliHelperId)

    const executeCommand = async () => {
      const coreCLIHelper = await coreCLIHelperPromise
      return this._plugin.runCommand(request.args, coreCLIHelper)
    }

    const sendAnalytics = async () => {
      const coreCLIHelper = await coreCLIHelperPromise
      return this.sendAnalytics(coreCLIHelper)
    }

    Promise.allSettled([
      executeCommand()
        .then(() => this.waitForFlush())
        .then(() => callback(null, {}))
        .catch((err: Error) => {
          logCommandError(err)
          callback(err)
        }),
      sendAnalytics(),
    ])
  }

  shutdown: handleUnaryCall<Empty, Empty> = (_call, callback): void => {
    this.waitForFlush()
      .then(() => {
        callback(null, {})

        // Force shutdown to avoid hanging due to open stdio/broker streams
        setTimeout(() => {
          try {
            this._signalShutdown()
            process.exit(0)
          } catch {
            // ignore errors during shutdown to avoid masking host behavior
          }
        }, 100)
      })
      .catch((err: Error) => {
        callback(err)
      })
  }

  streamStdio: handleServerStreamingCall<Empty, StdioData> = call => {
    const origStdoutWrite: typeof process.stdout.write = process.stdout.write.bind(
      process.stdout,
    )
    const origStderrWrite: typeof process.stderr.write = process.stderr.write.bind(
      process.stderr,
    )
    // Bun's `console.log` / `console.error` bypass `process.stdout.write` — the
    // write hooks below are therefore insufficient on their own. Snapshot the
    // current console methods so we can (a) wrap them and (b) restore on
    // cleanup.
    const origConsoleLog = console.log.bind(console)
    const origConsoleInfo = console.info.bind(console)
    const origConsoleWarn = console.warn.bind(console)
    const origConsoleError = console.error.bind(console)
    const origConsoleDebug = console.debug.bind(console)

    let isWriting = false

    const processQueue = () => {
      if (isWriting || this._writeQueue.length === 0) {
        return
      }

      isWriting = true
      const item = this._writeQueue.shift()!

      const writeSucceeded = call.write(
        { channel: item.channel, data: item.data },
        (err?: Error | null) => {
          isWriting = false

          if (item.cb) {
            item.cb(err)
          }

          processQueue()
        },
      )

      if (!writeSucceeded) {
        console.log('waiting for drain....')
        // Backpressure - wait for drain
        return
      }

      // Write succeeded, continue processing
      processQueue()
    }

    call.on('drain', () => {
      processQueue()
    })

    const forward = (
      channel: number,
      chunk: string | Uint8Array,
      cb: ((err?: Error | null) => void) | undefined,
    ): boolean => {
      const data: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))

      this._writeQueue.push({ channel, data, cb })
      processQueue()

      return true
    }

    function wrapWrite(
      original: typeof process.stdout.write,
      channel: number,
    ): typeof process.stdout.write {
      return function write(
        chunk: string | Uint8Array,
        encoding?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void,
      ): boolean {
        if (typeof encoding === 'function') {
          cb = encoding as (err?: Error | null) => void
          encoding = undefined
        }
        if (encoding) {
          original(chunk, encoding, cb)
        } else {
          original(chunk, cb)
        }
        return forward(channel, chunk, cb)
      } as typeof process.stdout.write
    }
    process.stdout.write = wrapWrite(origStdoutWrite, StdioData_Channel.STDOUT)
    process.stderr.write = wrapWrite(origStderrWrite, StdioData_Channel.STDERR)

    // Wrap console.* methods so plugin output via console.log/info/warn/error/debug
    // is forwarded to the host regardless of whether the runtime routes those
    // methods through process.stdout.write (Node does; Bun does not — see
    // https://github.com/oven-sh/bun/issues/9573). Each wrap calls the ORIGINAL
    // write (not the wrapped one) to avoid double-forwarding on runtimes where
    // console.* internally calls process.stdout.write.
    const wrapConsole = (
      originalWrite: typeof process.stdout.write,
      channel: number,
    ): ((...args: unknown[]) => void) => {
      return (...args: unknown[]): void => {
        const text = `${util.format(...args)}\n`
        originalWrite(text)
        forward(channel, text, undefined)
      }
    }
    console.log = wrapConsole(origStdoutWrite, StdioData_Channel.STDOUT)
    console.info = wrapConsole(origStdoutWrite, StdioData_Channel.STDOUT)
    console.debug = wrapConsole(origStdoutWrite, StdioData_Channel.STDOUT)
    console.warn = wrapConsole(origStderrWrite, StdioData_Channel.STDERR)
    console.error = wrapConsole(origStderrWrite, StdioData_Channel.STDERR)

    const cleanup = () => {
      process.stdout.write = origStdoutWrite
      process.stderr.write = origStderrWrite
      console.log = origConsoleLog
      console.info = origConsoleInfo
      console.warn = origConsoleWarn
      console.error = origConsoleError
      console.debug = origConsoleDebug
    }

    call.on('cancelled', () => {
      cleanup()
    })
    call.on('close', () => {
      cleanup()
    })
  }

  private applyAdditionalInfo(additionalInfo: AdditionalInfo | undefined): void {
    if (additionalInfo?.isTerminal) {
      TerminalInfo.hostStdinIsTerminal = additionalInfo.isTerminal.stdin ?? true
      TerminalInfo.hostStdoutIsTerminal = additionalInfo.isTerminal.stdout ?? true
      TerminalInfo.hostStderrIsTerminal = additionalInfo.isTerminal.stderr ?? true
    }
    if (additionalInfo?.terminalDimensions) {
      TerminalInfo.dimensions = additionalInfo.terminalDimensions
    }
  }

  private async getBestEffortCoreCLIHelper(
    coreCliHelperId: number | undefined,
  ): Promise<CoreCLIHelper | undefined> {
    let coreCLIHelper: CoreCLIHelper | undefined
    if (coreCliHelperId !== undefined && coreCliHelperId !== 0) {
      try {
        const helperConn = await this._broker.dial(coreCliHelperId)
        coreCLIHelper = new CoreCLIHelperClient(helperConn)
        initKeychain(coreCLIHelper)
      } catch {
        // CoreCLIHelper unavailable (e.g. CLI version that doesn't fully implement
        // the broker dial response). Continue without it — coreCLIHelper will be
        // undefined and getKeychain() will throw. Use getOptionalKeychain() if
        // keychain access is best-effort for your plugin.
      }
    }
    return coreCLIHelper
  }

  private async sendAnalytics(coreCLIHelper: CoreCLIHelper | undefined): Promise<void> {
    if (!coreCLIHelper || !this._pluginMetadata) {
      return Promise.resolve()
    }
    return coreCLIHelper
      .sendAnalytics('Plugin invoked', this.formatPluginMetadata(this._pluginMetadata))
      .catch(() => undefined)
  }

  private formatPluginMetadata(pluginMetadata: PluginMetadata): string {
    return `${pluginMetadata.name}@${pluginMetadata.version}`
  }
}
