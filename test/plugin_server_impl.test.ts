import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { PluginServerImpl } from '../src/grpc/plugin_server_impl'
import { StdioData_Channel } from '../src/grpc/proto/plugin/grpc_stdio'
import { GRPCBroker } from '../src/grpc/grpc_broker'
import type { PluginCommand } from '../src/grpc/plugin_server_impl'

class NoopPlugin implements PluginCommand {
  async runCommand(): Promise<void> {
    // no-op
  }
}

/**
 * Minimal stand-in for a gRPC ServerWritableStream used by `streamStdio`.
 * We only implement what `PluginServerImpl.streamStdio` actually touches:
 * `write(msg, cb)`, `on('drain' | 'cancelled' | 'close', handler)`.
 */
function makeFakeCall(): {
  writes: { channel: number; data: Buffer }[]
  emit: (event: 'cancelled' | 'close') => void
  call: Parameters<PluginServerImpl['streamStdio']>[0]
} {
  const writes: { channel: number; data: Buffer }[] = []
  const listeners: Record<string, Array<() => void>> = {}
  const on = (event: string, handler: () => void): unknown => {
    listeners[event] ??= []
    listeners[event].push(handler)
    return undefined
  }
  const emit = (event: 'cancelled' | 'close'): void => {
    ;(listeners[event] ?? []).forEach(h => h())
  }
  const write = (
    msg: { channel: number; data: Buffer | Uint8Array },
    cb?: (err?: Error | null) => void,
  ): boolean => {
    writes.push({
      channel: msg.channel,
      data: Buffer.isBuffer(msg.data) ? msg.data : Buffer.from(msg.data),
    })
    if (cb) {
      setImmediate(() => cb(null))
    }
    return true
  }

  const call = { on, write } as unknown as Parameters<PluginServerImpl['streamStdio']>[0]
  return { writes, emit, call }
}

function capturedText(
  writes: { channel: number; data: Buffer }[],
  channel: number,
): string {
  return writes
    .filter(w => w.channel === channel)
    .map(w => w.data.toString('utf8'))
    .join('')
}

/**
 * Wait until `fn()` returns true or the timeout elapses.
 */
async function waitUntil(fn: () => boolean, timeoutMs = 500, stepMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return
    await new Promise(r => setTimeout(r, stepMs))
  }
}

describe('plugin_server_impl: streamStdio captures console.*', () => {
  // Save + restore globals that the code-under-test patches, so the test file
  // itself is isolated from side effects.
  const originals = {
    stdoutWrite: process.stdout.write.bind(process.stdout),
    stderrWrite: process.stderr.write.bind(process.stderr),
    consoleLog: console.log.bind(console),
    consoleInfo: console.info.bind(console),
    consoleWarn: console.warn.bind(console),
    consoleError: console.error.bind(console),
    consoleDebug: console.debug.bind(console),
  }

  let impl: PluginServerImpl
  let fake: ReturnType<typeof makeFakeCall>

  beforeEach(() => {
    impl = new PluginServerImpl(() => {}, new NoopPlugin(), new GRPCBroker(), {
      name: 'test',
      version: '0.0.0',
    })
    fake = makeFakeCall()
    // Silence real terminal output during the test — the wrappers still call
    // the (now-silenced) originals, but we only assert on gRPC-forwarded data.
    process.stdout.write = (() => true) as unknown as typeof process.stdout.write
    process.stderr.write = (() => true) as unknown as typeof process.stderr.write
    impl.streamStdio(fake.call)
  })

  afterEach(() => {
    fake.emit('close')
    process.stdout.write = originals.stdoutWrite
    process.stderr.write = originals.stderrWrite
    console.log = originals.consoleLog
    console.info = originals.consoleInfo
    console.warn = originals.consoleWarn
    console.error = originals.consoleError
    console.debug = originals.consoleDebug
  })

  it('forwards console.log to STDOUT channel', async () => {
    console.log('hello', 'world', { n: 1 })
    await waitUntil(() => capturedText(fake.writes, StdioData_Channel.STDOUT).length > 0)
    expect(capturedText(fake.writes, StdioData_Channel.STDOUT)).toBe(
      'hello world { n: 1 }\n',
    )
  })

  it('forwards console.info to STDOUT channel', async () => {
    console.info('info-line')
    await waitUntil(() => capturedText(fake.writes, StdioData_Channel.STDOUT).length > 0)
    expect(capturedText(fake.writes, StdioData_Channel.STDOUT)).toBe('info-line\n')
  })

  it('forwards console.error to STDERR channel', async () => {
    console.error('err-line')
    await waitUntil(() => capturedText(fake.writes, StdioData_Channel.STDERR).length > 0)
    expect(capturedText(fake.writes, StdioData_Channel.STDERR)).toBe('err-line\n')
  })

  it('forwards console.warn to STDERR channel', async () => {
    console.warn('warn-line')
    await waitUntil(() => capturedText(fake.writes, StdioData_Channel.STDERR).length > 0)
    expect(capturedText(fake.writes, StdioData_Channel.STDERR)).toBe('warn-line\n')
  })

  it('forwards process.stdout.write directly without double-emitting via console.log', async () => {
    // Direct writes go through the write-wrapper and must emit exactly once.
    process.stdout.write('direct\n')
    await waitUntil(() => capturedText(fake.writes, StdioData_Channel.STDOUT).length > 0)
    expect(capturedText(fake.writes, StdioData_Channel.STDOUT)).toBe('direct\n')
  })

  it('restores console.* and process.*.write after the stream closes', () => {
    const wrappedLog = console.log
    const wrappedStdoutWrite = process.stdout.write
    fake.emit('close')
    // After cleanup, the console/write methods are no longer the wrappers
    // installed by streamStdio. (We can't assert strict equality against the
    // pre-streamStdio originals because streamStdio takes a .bind()'d snapshot
    // internally — a fresh Function identity.)
    expect(console.log).not.toBe(wrappedLog)
    expect(process.stdout.write).not.toBe(wrappedStdoutWrite)
    // And after restore, console.log must no longer forward to the gRPC
    // stream — the writes array stays empty.
    const writesBefore = fake.writes.length
    console.log('post-cleanup line')
    expect(fake.writes.length).toBe(writesBefore)
  })
})
