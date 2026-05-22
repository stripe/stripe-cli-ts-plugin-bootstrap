import { handleBidiStreamingCall, ServerDuplexStream } from '@grpc/grpc-js'
import { GRPCBrokerServer, ConnInfo } from './proto/plugin/grpc_broker.js'
import { TypedServiceImplementation } from './server.js'
import * as grpc from '@grpc/grpc-js'

const DIAL_TIMEOUT_MS = 5000

/**
 * State of a per-service-id slot in the broker's pending map.
 *
 * Either a `dial()` call is in flight and waiting for the host's announcement
 * (`waiter`), or the host's announcement has already arrived and is parked
 * waiting for a future `dial()` call (`received`). The two states are mutually
 * exclusive; whichever side arrives first parks, and the other side fulfills.
 */
type PendingEntry =
  | {
      kind: 'waiter'
      resolve: (connInfo: ConnInfo) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  | {
      kind: 'received'
      connInfo: ConnInfo
      /** Cleared if dial() consumes the announcement before it ages out. */
      gcTimer: ReturnType<typeof setTimeout>
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
  private pending: Map<number, PendingEntry> = new Map()
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
      this.tearDown(new Error('Broker stream ended'))
      call.end()
    })

    call.on('error', err => {
      this.tearDown(err)
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
    if (existing?.kind === 'waiter') {
      throw new Error(`dial(${serviceId}) already in progress`)
    }
    if (existing?.kind === 'received') {
      clearTimeout(existing.gcTimer)
      this.pending.delete(serviceId)
      return this.connectTo(existing.connInfo)
    }

    const connInfo = await new Promise<ConnInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = this.pending.get(serviceId)
        if (current?.kind === 'waiter' && current.resolve === resolve) {
          this.pending.delete(serviceId)
          reject(new Error(`Dial timeout for service ${serviceId}`))
        }
      }, DIAL_TIMEOUT_MS)

      this.pending.set(serviceId, { kind: 'waiter', resolve, reject, timer })
    })

    return this.connectTo(connInfo)
  }

  private connectTo(connInfo: ConnInfo): grpc.Client {
    // Broker dial targets are loopback (TCP or unix socket) — insecure creds
    // match what go-plugin uses and what the host expects.
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
      if (pending?.kind === 'waiter') {
        clearTimeout(pending.timer)
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
    if (existing?.kind === 'waiter') {
      clearTimeout(existing.timer)
      this.pending.delete(connInfo.serviceId)
      existing.resolve(connInfo)
      return
    }

    // Announcement arrived before dial(). Park it, and GC the slot after the
    // dial-timeout window if no one ever consumes it — matches go-plugin's
    // timeoutWait so a misbehaving host can't leak slots indefinitely.
    if (existing?.kind === 'received') {
      clearTimeout(existing.gcTimer)
    }
    const gcTimer = setTimeout(() => {
      const current = this.pending.get(connInfo.serviceId)
      if (current?.kind === 'received' && current.connInfo === connInfo) {
        this.pending.delete(connInfo.serviceId)
      }
    }, DIAL_TIMEOUT_MS)
    this.pending.set(connInfo.serviceId, {
      kind: 'received',
      connInfo,
      gcTimer,
    })
  }

  private tearDown(reason: Error): void {
    this.stream = null
    this.closed = true
    for (const [, entry] of this.pending) {
      if (entry.kind === 'waiter') {
        clearTimeout(entry.timer)
        entry.reject(reason)
      } else {
        clearTimeout(entry.gcTimer)
      }
    }
    this.pending.clear()
  }

  /**
   * Close closes the broker and rejects all pending dials.
   */
  close(): void {
    if (this.closed) {
      return
    }
    if (this.stream) {
      this.stream.end()
    }
    this.tearDown(new Error('Broker closed'))
  }
}
