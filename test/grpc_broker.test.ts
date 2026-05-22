import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as grpc from '@grpc/grpc-js'
import { GRPCBroker } from '../src/grpc/grpc_broker'

class FakeBrokerStream extends EventEmitter {
  write = vi.fn()
  end = vi.fn()
}

describe('GRPCBroker', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('connects when the host announces a ConnInfo before dial() is called', async () => {
    const broker = new GRPCBroker()
    const stream = new FakeBrokerStream()
    broker.startStream(stream as any)

    // Host announces the service first (go-plugin v1.7.0 non-mux behavior).
    stream.emit('data', {
      serviceId: 42,
      network: 'tcp',
      address: '127.0.0.1:1234',
      knock: undefined,
    })

    const client = await broker.dial(42)
    expect(client).toBeInstanceOf(grpc.Client)
    // Plugin never sends a knock — it only listens for announcements.
    expect(stream.write).not.toHaveBeenCalled()
    client.close()
  })

  it('connects when dial() is called before the announcement arrives', async () => {
    const broker = new GRPCBroker()
    const stream = new FakeBrokerStream()
    broker.startStream(stream as any)

    const dialPromise = broker.dial(42)

    // Announcement arrives after dial().
    await new Promise(r => setImmediate(r))
    stream.emit('data', {
      serviceId: 42,
      network: 'tcp',
      address: '127.0.0.1:1234',
      knock: undefined,
    })

    const client = await dialPromise
    expect(client).toBeInstanceOf(grpc.Client)
    client.close()
  })

  it('times out if no announcement arrives within 5s', async () => {
    vi.useFakeTimers()

    const broker = new GRPCBroker()
    const stream = new FakeBrokerStream()
    broker.startStream(stream as any)

    const dialPromise = broker.dial(7)
    const rejection = expect(dialPromise).rejects.toThrow('Dial timeout for service 7')

    await vi.advanceTimersByTimeAsync(5010)
    await rejection
  })

  it('rejects pending dials when the broker stream ends', async () => {
    const broker = new GRPCBroker()
    const stream = new FakeBrokerStream()
    broker.startStream(stream as any)

    const dialPromise = broker.dial(11)
    const rejection = expect(dialPromise).rejects.toThrow('Broker stream ended')

    stream.emit('end')
    await rejection
  })

  it('rejects an explicit knock from the host (mux mode not supported)', async () => {
    const broker = new GRPCBroker()
    const stream = new FakeBrokerStream()
    broker.startStream(stream as any)

    const dialPromise = broker.dial(99)
    const rejection = expect(dialPromise).rejects.toThrow(/mux mode is not supported/)

    stream.emit('data', {
      serviceId: 99,
      network: '',
      address: '',
      knock: { knock: true, ack: false, error: '' },
    })
    await rejection
  })
})
