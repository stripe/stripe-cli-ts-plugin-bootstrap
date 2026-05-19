import { handleBidiStreamingCall, ServerDuplexStream } from '@grpc/grpc-js'
import { GRPCBrokerServer, ConnInfo } from './proto/plugin/grpc_broker.js'
import { TypedServiceImplementation } from './server.js'
import * as grpc from '@grpc/grpc-js'

/**
 * Pending dial request waiting for a response
 */
interface PendingDial {
  resolve: (connInfo: { network: string; address: string }) => void
  reject: (err: Error) => void
}

/**
 * GRPCBroker is responsible for brokering connections by unique ID.
 *
 * It is used by plugins to create multiple gRPC connections and data
 * streams between the plugin process and the host process.
 *
 * This allows a plugin to request a channel with a specific ID to connect to
 * or accept a connection from, and the broker handles the details of
 * holding these channels open while they're being negotiated.
 *
 * Ported from: https://github.com/hashicorp/go-plugin/blob/main/grpc_broker.go
 */
export class GRPCBroker implements TypedServiceImplementation<GRPCBrokerServer> {
  private stream: ServerDuplexStream<ConnInfo, ConnInfo> | null = null
  private pendingDials: Map<number, PendingDial> = new Map()
  private nextId = 0
  private closed = false

  /**
   * StartStream implements the GRPCBroker service.
   * This is called by the host to establish the bidirectional broker stream.
   */
  startStream: handleBidiStreamingCall<ConnInfo, ConnInfo> = call => {
    this.stream = call

    // Handle incoming connection info from the host
    call.on('data', (connInfo: ConnInfo) => {
      this.handleConnInfo(connInfo)
    })

    call.on('end', () => {
      this.stream = null
      this.closed = true
      // Reject all pending dials
      for (const [_serviceId, pending] of this.pendingDials.entries()) {
        pending.reject(new Error('Broker stream ended'))
      }
      this.pendingDials.clear()
      call.end()
    })

    call.on('error', err => {
      this.stream = null
      this.closed = true
      // Reject all pending dials
      for (const [_serviceId, pending] of this.pendingDials.entries()) {
        pending.reject(err)
      }
      this.pendingDials.clear()
    })
  }

  /**
   * Dial opens a connection by ID.
   * This sends a "knock" to the host and waits for the connection info response.
   *
   * @param serviceId - The service ID to dial (provided by the host in RPC requests)
   * @returns A gRPC client connection to the service
   */
  async dial(serviceId: number): Promise<grpc.Client> {
    if (this.closed) {
      throw new Error('Broker is closed')
    }

    if (!this.stream) {
      // The host may send RunCommand before the broker stream is established — wait for it.
      const deadline = Date.now() + 5000
      while (!this.stream) {
        if (this.closed) throw new Error('Broker is closed')
        if (Date.now() >= deadline) throw new Error('Broker stream not established yet')
        await new Promise(r => setTimeout(r, 10))
      }
    }

    const dialPromise = new Promise<{ network: string; address: string }>(
      (resolve, reject) => {
        this.pendingDials.set(serviceId, { resolve, reject })

        // Add timeout to prevent hanging forever
        setTimeout(() => {
          if (this.pendingDials.has(serviceId)) {
            this.pendingDials.delete(serviceId)
            reject(new Error(`Dial timeout for service ${serviceId}`))
          }
        }, 5000) // Match Go's 5 second timeout
      },
    )

    // Send knock request to the host
    const knockRequest: ConnInfo = {
      serviceId,
      network: '',
      address: '',
      knock: { knock: true, ack: false, error: '' },
    }

    this.stream.write(knockRequest)

    const { network, address } = await dialPromise

    // Format the address based on network type
    // For unix sockets, gRPC needs the "unix:" prefix
    let dialAddress = address
    if (network === 'unix' && !address.startsWith('unix:')) {
      dialAddress = `unix:${address}`
    }

    // Create a gRPC client to the service
    const client = new grpc.Client(dialAddress, grpc.credentials.createInsecure())
    return client
  }

  /**
   * Handle incoming connection info from the host
   */
  private handleConnInfo(connInfo: ConnInfo): void {
    const pending = this.pendingDials.get(connInfo.serviceId)
    if (!pending) {
      return
    }

    if (connInfo.knock?.error) {
      pending.reject(new Error(connInfo.knock.error))
      this.pendingDials.delete(connInfo.serviceId)
      return
    }

    // The host acknowledges by sending back the address (with or without knock.ack field)
    // If we have an address, the knock was successful
    if (connInfo.address) {
      pending.resolve({ network: connInfo.network, address: connInfo.address })
      this.pendingDials.delete(connInfo.serviceId)
    }
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

    // Reject all pending dials
    for (const [_serviceId, pending] of this.pendingDials.entries()) {
      pending.reject(new Error('Broker closed'))
    }
    this.pendingDials.clear()
  }
}
