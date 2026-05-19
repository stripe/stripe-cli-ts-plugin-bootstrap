import { handleUnaryCall, handleServerStreamingCall } from '@grpc/grpc-js'
import {
  HealthCheckRequest,
  HealthCheckResponse,
  HealthCheckResponse_ServingStatus,
  HealthServer,
} from './proto/grpc/health/v1/health.js'
import { TypedServiceImplementation } from './server.js'

export class HealthServerImpl implements TypedServiceImplementation<HealthServer> {
  private _statusMap: Map<string, number>

  constructor() {
    this._statusMap = new Map<string, number>()
    this._statusMap.set('plugin', HealthCheckResponse_ServingStatus.SERVING)
  }

  check: handleUnaryCall<HealthCheckRequest, HealthCheckResponse> = (call, callback) => {
    // Implement health check logic here
    const service = call.request?.service || ''
    const status =
      this._statusMap.get(service || 'plugin') ??
      HealthCheckResponse_ServingStatus.SERVICE_UNKNOWN
    callback(null, { status })
  }

  setStatus = (service: string, status: HealthCheckResponse_ServingStatus): void => {
    this._statusMap.set(service, status)
  }

  watch: handleServerStreamingCall<HealthCheckRequest, HealthCheckResponse> = call => {
    const service = call.request?.service || 'plugin'
    const status =
      this._statusMap.get(service) ?? HealthCheckResponse_ServingStatus.SERVICE_UNKNOWN
    call.write({ status })
  }
}
