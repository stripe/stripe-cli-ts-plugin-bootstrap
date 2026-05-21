/**
 * Error thrown when a Stripe API request fails.
 * Ported from: stripe-cli/pkg/requests/base.go RequestError
 * @public
 */
export class StripeRequestError extends Error {
  readonly statusCode: number
  readonly errorType: string
  readonly errorCode: string
  readonly requestId: string
  readonly body: string

  constructor(opts: {
    statusCode: number
    errorType: string
    errorCode: string
    requestId: string
    body: string
  }) {
    super(
      `Request failed, status=${opts.statusCode}, type=${opts.errorType}, code=${opts.errorCode}`,
    )
    this.name = 'StripeRequestError'
    this.statusCode = opts.statusCode
    this.errorType = opts.errorType
    this.errorCode = opts.errorCode
    this.requestId = opts.requestId
    this.body = opts.body
  }

  isAPIKeyExpired(): boolean {
    return this.statusCode === 401 && this.errorCode === 'api_key_expired'
  }
}
