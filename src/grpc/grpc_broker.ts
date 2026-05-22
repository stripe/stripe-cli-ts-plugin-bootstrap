import { handleBidiStreamingCall, ServerDuplexStream } from '@grpc/grpc-js'
import { GRPCBrokerServer, ConnInfo } from './proto/plugin/grpc_broker.js'
import { TypedServiceImplementation } from './server.js'
import * as grpc from '@grpc/grpc-js'

/**
 * A buffered slot for one service id. The host announces a service via a
 * ConnInfo on the broker stream; dial(id) waits on the same slot for that
 * announcement. Whichever side arrives first parks; the other side fulfills.
 */
interface PendingStream {
  resolve: (connInfo: ConnInfo) => void
  reject: (err: Error) => void
  /** Set once the announcement is in hand, in case dial() is called later. */
  received?: ConnInfo
}

/**
 * GRPCBroker is responsible for brokering connections by unique ID.
 *
 * It is used by plugins to create multiple gRPC connections and data
 * streams between the plugin process and the host process.
 *
 * Ported from: https://github.com/hashicorp/go-plugin/blob/v1.7.0/grpc_broker.go
 *
 * Protocol (non-mux mode, which is what the Stripe CLI uses):
 *   - The host calls `Accept(id)` on its broker, which sends a ConnInfo
 *     `{ service_id, network, address }` (no `knock` set) over the stream
 *     to announce a service.
 *   - The plugin's `dial(id)` waits for that announcement and then opens a
 *     gRPC client to the announced address.
 *   - Announcements can arrive before or after dial(); both orderings are
 *     supported by parking the first-arriving party on a per-id slot.
 */
export class GRPCBroker implements TypedServiceImplementation<GRPCBrokerServer> {
  private stream: ServerDuplexStream<ConnInfo, ConnInfo> | null = null
  private pending: Map<number, PendingStream> = new Map()
  private nextId = 0
  private closed = false

  /**
   * StartStream implements the GRPCBroker service.
   * This is called by the host to establish the bidirectional broker stream.
   */
  startStream: handleBidiStreamingCall<ConnInfo, ConnInfo> = call => {
    this.stream = call

    call.on('data', (connInfo: ConnInfo) => {
      this.handleConnInfo(connInfo)
    })

    call.on('end', () => {
      this.stream = null
      this.closed = true
      for (const [, slot] of this.pending) {
        if (!slot.received) slot.reject(new Error('Broker stream ended'))
      }
      this.pending.clear()
      call.end()
    })

    call.on('error', err => {
      this.stream = null
      this.closed = true
      for (const [, slot] of this.pending) {
        if (!slot.received) slot.reject(err)
      }
      this.pending.clear()
    })
  }

  /**
   * Dial opens a connection by ID.
   *
   * Waits for the host to announce a ConnInfo for the given service id, then
   * connects to the announced address. If the announcement has already
   * arrived, dial returns immediately.
   *
   * @param serviceId - The service ID to dial (provided by the host in RPC requests)
   * @returns A gRPC client connection to the service
   */
  async dial(serviceId: number): Promise<grpc.Client> {
    if (this.closed) {
      throw new Error('Broker is closed')
    }

    const existing = this.pending.get(serviceId)
    if (existing?.received) {
      this.pending.delete(serviceId)
      return this.connectTo(existing.received)
    }

    const connInfo = await new Promise<ConnInfo>((resolve, reject) => {
      const slot: PendingStream = { resolve, reject }
      this.pending.set(serviceId, slot)

      setTimeout(() => {
        const current = this.pending.get(serviceId)
        if (current === slot && !current.received) {
          this.pending.delete(serviceId)
          reject(new Error(`Dial timeout for service ${serviceId}`))
        }
      }, 5000)
    })

    return this.connectTo(connInfo)
  }

  private connectTo(connInfo: ConnInfo): grpc.Client {
    let dialAddress = connInfo.address
    if (connInfo.network === 'unix' && !dialAddress.startsWith('unix:')) {
      dialAddress = `unix:${dialAddress}`
    }
    return new grpc.Client(dialAddress, grpc.credentials.createInsecure())
  }

  /**
   * Handle a ConnInfo received on the broker stream.
   *
   * In non-mux mode (the only mode we support), the host only ever sends
   * announcements: ConnInfo with network+address and no knock. If dial(id)
   * is already waiting we resolve it; otherwise we park the announcement so
   * a later dial(id) can pick it up.
   */
  private handleConnInfo(connInfo: ConnInfo): void {
    // Defensive: knocks aren't part of the non-mux protocol, but the proto
    // includes the field. Reject knocks explicitly so a misconfigured host
    // surfaces an error instead of hanging.
    if (connInfo.knock?.knock) {
      const pending = this.pending.get(connInfo.serviceId)
      if (pending && !pending.received) {
        this.pending.delete(connInfo.serviceId)
        pending.reject(
          new Error(
            `Broker received an unexpected knock for service ${connInfo.serviceId}; mux mode is not supported`,
          ),
        )
      }
      return
    }

    const existing = this.pending.get(connInfo.serviceId)
    if (existing && !existing.received) {
      this.pending.delete(connInfo.serviceId)
      existing.resolve(connInfo)
      return
    }

    // Announcement arrived before dial(). Park it so dial() can pick it up.
    this.pending.set(connInfo.serviceId, {
      received: connInfo,
      // Park noop resolve/reject so the slot's shape is stable.
      resolve: () => {},
      reject: () => {},
    })
  }

  /**
   * NextId returns a unique ID to use next.
   *
   * It is possible for very long-running plugin hosts to wrap this value,
   * though it would require a very large amount of calls.
   */
  nextServiceId(): number {
    return ++this.nextId
  }

  /**
   * Close closes the broker and rejects all pending dials.
   */
  close(): void {
    if (this.closed) {
      return
    }

    this.closed = true

    if (this.stream) {
      this.stream.end()
      this.stream = null
    }

    for (const [, slot] of this.pending) {
      if (!slot.received) slot.reject(new Error('Broker closed'))
    }
    this.pending.clear()
  }
}
