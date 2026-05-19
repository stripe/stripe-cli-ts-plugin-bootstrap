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

  it('waits for the broker stream to be established before dialing', async () => {
    vi.useFakeTimers()

    const broker = new GRPCBroker()
    const dialPromise = broker.dial(42)

    await vi.advanceTimersByTimeAsync(20)

    const stream = new FakeBrokerStream()
    broker.startStream(stream as any)

    await vi.advanceTimersByTimeAsync(10)

    expect(stream.write).toHaveBeenCalledWith({
      serviceId: 42,
      network: '',
      address: '',
      knock: { knock: true, ack: false, error: '' },
    })

    stream.emit('data', {
      serviceId: 42,
      network: 'tcp',
      address: '127.0.0.1:1234',
      knock: { knock: false, ack: true, error: '' },
    })

    const client = await dialPromise
    expect(client).toBeInstanceOf(grpc.Client)
    client.close()
  })

  it('times out if the broker stream is never established', async () => {
    vi.useFakeTimers()

    const broker = new GRPCBroker()
    const dialPromise = broker.dial(7)
    const rejection = expect(dialPromise).rejects.toThrow(
      'Broker stream not established yet',
    )

    await vi.advanceTimersByTimeAsync(5010)

    await rejection
  })
})
