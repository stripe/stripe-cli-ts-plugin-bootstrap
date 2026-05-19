import * as grpc from '@grpc/grpc-js'
import { CoreCLIHelperService } from './proto/proto/main.js'

/**
 * Interface for calling back to the Stripe CLI host for helper functions.
 *
 * @public
 */
export interface CoreCLIHelper {
  /**
   * Echo sends a string to the host CLI and receives it back.
   * Used for testing the RPC connection.
   */
  echo(input: string): Promise<string>

  /**
   * SendAnalytics sends a telemetry event to the Stripe CLI host.
   * The host will forward the event to Stripe's analytics service.
   *
   * @param eventName - The name of the event (e.g., "plugin_command_executed")
   * @param eventValue - Optional value associated with the event (e.g., command details)
   */
  sendAnalytics(eventName: string, eventValue: string): Promise<void>

  /**
   * Retrieve a password from the system keychain.
   * @param key - The account/key identifier
   * @returns The stored value, or null if not found
   */
  keychainGetPassword(key: string): Promise<string | null>

  /**
   * Store a password in the system keychain.
   * @param key - The account/key identifier
   * @param value - The secret value to store
   */
  keychainSetPassword(key: string, value: string): Promise<void>

  /**
   * Delete a password from the system keychain.
   * @param key - The account/key identifier
   * @returns true if deleted, false if not found
   */
  keychainDeletePassword(key: string): Promise<boolean>

  /**
   * List all keys stored in the system keychain for this service.
   * @returns Array of key identifiers
   */
  keychainFindCredentials(): Promise<string[]>

  /**
   * Run another Stripe CLI plugin by name.
   * @param pluginName - The shortname of the plugin to run
   * @param args - Arguments to pass to the plugin
   * @param cwd - Working directory for the plugin
   */
  runPeerPlugin(pluginName: string, args: string[], cwd: string): Promise<void>
}

function handleServiceError(err: grpc.ServiceError) {
  if (err.code === grpc.status.UNIMPLEMENTED) {
    console.log(
      `This feature requires a newer version of the Stripe CLI. Upgrade to use this feature: https://docs.stripe.com/stripe-cli/upgrade`,
    )
  }
}

/**
 * CoreCLIHelperClient implements CoreCLIHelper by making gRPC calls
 * to the host's CoreCLIHelper service.
 */
export class CoreCLIHelperClient implements CoreCLIHelper {
  private client: grpc.Client

  constructor(client: grpc.Client) {
    this.client = client
  }

  private makeRequest<TRequest, TResponse>(
    path: string,
    requestSerialize: (value: TRequest) => Buffer,
    responseDeserialize: (value: Buffer) => TResponse,
    request: TRequest,
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      this.client.makeUnaryRequest(
        path,
        requestSerialize,
        responseDeserialize,
        request,
        (err, response) => {
          if (err) {
            handleServiceError(err)
            reject(err)
          } else if (response) {
            resolve(response)
          } else {
            reject(new Error(`No response from ${path} RPC`))
          }
        },
      )
    })
  }

  async echo(input: string): Promise<string> {
    const response = await this.makeRequest(
      CoreCLIHelperService.echo.path,
      CoreCLIHelperService.echo.requestSerialize,
      CoreCLIHelperService.echo.responseDeserialize,
      { input },
    )
    return response.output
  }

  async sendAnalytics(eventName: string, eventValue: string): Promise<void> {
    await this.makeRequest(
      CoreCLIHelperService.sendAnalytics.path,
      CoreCLIHelperService.sendAnalytics.requestSerialize,
      CoreCLIHelperService.sendAnalytics.responseDeserialize,
      { eventName, eventValue },
    )
  }

  async keychainGetPassword(key: string): Promise<string | null> {
    const response = await this.makeRequest(
      CoreCLIHelperService.keychainGetPassword.path,
      CoreCLIHelperService.keychainGetPassword.requestSerialize,
      CoreCLIHelperService.keychainGetPassword.responseDeserialize,
      { key },
    )
    return response.found ? response.value : null
  }

  async keychainSetPassword(key: string, value: string): Promise<void> {
    await this.makeRequest(
      CoreCLIHelperService.keychainSetPassword.path,
      CoreCLIHelperService.keychainSetPassword.requestSerialize,
      CoreCLIHelperService.keychainSetPassword.responseDeserialize,
      { key, value },
    )
  }

  async keychainDeletePassword(key: string): Promise<boolean> {
    const response = await this.makeRequest(
      CoreCLIHelperService.keychainDeletePassword.path,
      CoreCLIHelperService.keychainDeletePassword.requestSerialize,
      CoreCLIHelperService.keychainDeletePassword.responseDeserialize,
      { key },
    )
    return response.deleted
  }

  async keychainFindCredentials(): Promise<string[]> {
    const response = await this.makeRequest(
      CoreCLIHelperService.keychainFindCredentials.path,
      CoreCLIHelperService.keychainFindCredentials.requestSerialize,
      CoreCLIHelperService.keychainFindCredentials.responseDeserialize,
      {},
    )
    return response.keys
  }

  async runPeerPlugin(pluginName: string, args: string[], cwd: string): Promise<void> {
    await this.makeRequest(
      CoreCLIHelperService.runPeerPlugin.path,
      CoreCLIHelperService.runPeerPlugin.requestSerialize,
      CoreCLIHelperService.runPeerPlugin.responseDeserialize,
      { pluginName, args, cwd },
    )
  }
}
