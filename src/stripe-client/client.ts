/**
 * HTTP client for the Stripe API.
 * Ported from: stripe-cli/pkg/stripe/client.go and stripe-cli/pkg/requests/base.go
 */

import * as http from 'http'
import * as https from 'https'
import * as url from 'url'

import { ensureConfigInitialized } from '../config/config.js'
import { ProfileCredentialResolver } from './credential-resolver.js'
import { StripeRequestError } from './errors.js'
import type {
  StripeAuth,
  StripeClientOptions,
  StripeRequestOptions,
  StripeResponse,
} from './types.js'
import {
  buildUATHeaders,
  isUATAuth,
  redactUATHeaderValue,
  resolveUATBaseURL,
} from './uat.js'

const DEFAULT_API_BASE_URL = 'https://api.stripe.com'
const V1_CONTENT_TYPE = 'application/x-www-form-urlencoded'
const V2_CONTENT_TYPE = 'application/json'
const DEFAULT_USER_AGENT = 'Stripe/v1 stripe-cli/unknown plugin/unknown'

let defaultUserAgent: string = DEFAULT_USER_AGENT

/**
 * Set the default user agent for all StripeClient instances that don't provide one explicitly.
 * Typically called once during plugin startup with the plugin's name and version.
 * @public
 */
export function setDefaultUserAgent(pluginName: string, pluginVersion: string): void {
  defaultUserAgent = `Stripe/v1 stripe-cli/unknown ${pluginName}/${pluginVersion}`
}

const PRINTABLE_HEADERS = [
  'authorization',
  'content-type',
  'cookie',
  'date',
  'idempotency-key',
  'idempotency-replayed',
  'request-id',
  'stripe-account',
  'stripe-context',
  'stripe-livemode',
  'stripe-version',
]

function isV2Path(path: string): boolean {
  return path.startsWith('/v2')
}

function isJSONPath(path: string): boolean {
  return isV2Path(path) || path.startsWith('/graphql')
}

function redactHeaderValue(name: string, value: string): string {
  const uatRedacted = redactUATHeaderValue(name, value)
  if (uatRedacted !== undefined) {
    return uatRedacted
  }
  if (name.toLowerCase() === 'authorization') {
    const match = value.match(/^(bearer|basic)\s+/i)
    if (match) {
      return `${match[1]} [REDACTED]`
    }
    return '[REDACTED]'
  }
  return value
}

function resolveExplicitAuth(options: StripeClientOptions): StripeAuth | null {
  if (options.auth === undefined) {
    return null
  }
  if (typeof options.auth === 'string') {
    return { type: 'api-key', apiKey: options.auth }
  }
  return options.auth
}

/**
 * Client for making authenticated requests to the Stripe API.
 *
 * Supports two authentication modes:
 * - API key: Traditional `Bearer` auth with sk_test/sk_live/rk_ keys
 * - UAT: User Access Token auth (see ./uat.ts for details)
 *
 * If no `auth` is provided, credentials are resolved lazily from the
 * config/keychain on the first request.
 *
 * @public
 */
export class StripeClient {
  private readonly baseURL: string
  private readonly explicitAuth: StripeAuth | null
  private readonly options: StripeClientOptions
  private readonly stripeAccount: string | undefined
  private readonly apiVersion: string | undefined
  private readonly userAgent: string
  private readonly verbose: boolean
  private resolvedAuth: StripeAuth | null = null

  constructor(options: StripeClientOptions = {}) {
    this.baseURL = options.baseURL ?? DEFAULT_API_BASE_URL
    this.explicitAuth = resolveExplicitAuth(options)
    this.options = options
    this.stripeAccount = options.stripeAccount
    this.apiVersion = options.apiVersion
    this.userAgent = options.userAgent ?? defaultUserAgent
    this.verbose = options.verbose ?? false
  }

  /**
   * Send a GET request to the Stripe API.
   */
  async get<T = unknown>(
    path: string,
    params?: Record<string, string>,
    options?: StripeRequestOptions,
  ): Promise<StripeResponse<T>> {
    return this.request<T>('GET', path, params, options)
  }

  /**
   * Send a POST request to the Stripe API.
   */
  async post<T = unknown>(
    path: string,
    params?: Record<string, string>,
    options?: StripeRequestOptions,
  ): Promise<StripeResponse<T>> {
    return this.request<T>('POST', path, params, options)
  }

  /**
   * Send a DELETE request to the Stripe API.
   */
  async delete<T = unknown>(
    path: string,
    params?: Record<string, string>,
    options?: StripeRequestOptions,
  ): Promise<StripeResponse<T>> {
    return this.request<T>('DELETE', path, params, options)
  }

  /**
   * Low-level request method. Handles encoding, headers, and error parsing.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    params?: Record<string, string>,
    options?: StripeRequestOptions,
  ): Promise<StripeResponse<T>> {
    const auth = await this.getAuth()
    const effectiveBaseURL = isUATAuth(auth)
      ? resolveUATBaseURL(path, this.baseURL, DEFAULT_API_BASE_URL)
      : this.baseURL
    const parsedBase = new url.URL(effectiveBaseURL)
    const resolvedURL = new url.URL(path, parsedBase)

    let body: string | undefined
    if (method === 'GET') {
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          resolvedURL.searchParams.append(key, value)
        }
      }
    } else {
      body = this.encodeBody(path, params)
    }

    const headers: Record<string, string> = this.buildHeaders(auth, path, options)

    if (this.verbose) {
      this.printRequestHeaders(method, resolvedURL, headers)
    }

    const response = await this.performHTTPRequest(method, resolvedURL, headers, body)

    if (this.verbose) {
      this.printResponseHeaders(response.statusCode, response.headers)
    }

    if (response.statusCode >= 400) {
      throw this.buildRequestError(response)
    }

    return {
      data: JSON.parse(response.body) as T,
      statusCode: response.statusCode,
      requestId: response.headers['request-id'] ?? '',
      headers: response.headers,
    }
  }

  private async getAuth(): Promise<StripeAuth> {
    if (this.explicitAuth) {
      return this.explicitAuth
    }
    if (!this.resolvedAuth) {
      const profile = this.options.profile ?? (await this.getGlobalProfile())
      const resolver = new ProfileCredentialResolver(profile)
      this.resolvedAuth = await resolver.resolve(this.options.livemode ?? false)
    }
    return this.resolvedAuth
  }

  private getGlobalProfile() {
    return ensureConfigInitialized().getProfile()
  }

  private buildHeaders(
    auth: StripeAuth,
    path: string,
    options?: StripeRequestOptions,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Content-Type': isJSONPath(path) ? V2_CONTENT_TYPE : V1_CONTENT_TYPE,
      'Accept-Encoding': 'identity',
    }

    if (isUATAuth(auth)) {
      Object.assign(headers, buildUATHeaders(auth, path, options))
    } else {
      headers['Authorization'] = `Bearer ${auth.apiKey}`

      const stripeAccount = options?.stripeAccount ?? this.stripeAccount
      if (stripeAccount) {
        headers['Stripe-Account'] = stripeAccount
      }
    }

    const apiVersion = options?.apiVersion ?? this.apiVersion
    if (apiVersion) {
      headers['Stripe-Version'] = apiVersion
    }

    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey
    }

    if (options?.headers) {
      Object.assign(headers, options.headers)
    }

    return headers
  }

  private encodeBody(path: string, params?: Record<string, string>): string | undefined {
    if (!params || Object.keys(params).length === 0) {
      return undefined
    }

    if (isJSONPath(path)) {
      return JSON.stringify(params)
    }

    const encoded = new url.URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      encoded.append(key, value)
    }
    return encoded.toString()
  }

  private performHTTPRequest(
    method: string,
    targetURL: url.URL,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const isHTTPS = targetURL.protocol === 'https:'
      const transport = isHTTPS ? https : http

      const requestOptions: http.RequestOptions = {
        method,
        hostname: targetURL.hostname,
        port: targetURL.port || (isHTTPS ? 443 : 80),
        path: targetURL.pathname + targetURL.search,
        headers,
      }

      const req = transport.request(requestOptions, res => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf-8')
          const responseHeaders: Record<string, string> = {}
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              responseHeaders[key] = value
            } else if (Array.isArray(value)) {
              responseHeaders[key] = value[0]
            }
          }
          resolve({
            statusCode: res.statusCode ?? 500,
            body: responseBody,
            headers: responseHeaders,
          })
        })
      })

      req.on('error', reject)

      if (body) {
        req.write(body)
      }
      req.end()
    })
  }

  private printRequestHeaders(
    method: string,
    targetURL: url.URL,
    headers: Record<string, string>,
  ): void {
    process.stderr.write(
      `> ${method} ${targetURL.protocol}//${targetURL.host}${targetURL.pathname}${targetURL.search}\n`,
    )
    for (const printable of PRINTABLE_HEADERS) {
      for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === printable && value) {
          process.stderr.write(`> ${name}: ${redactHeaderValue(name, value)}\n`)
        }
      }
    }
  }

  private printResponseHeaders(
    statusCode: number,
    headers: Record<string, string>,
  ): void {
    process.stderr.write(`< HTTP ${statusCode}\n`)
    for (const printable of PRINTABLE_HEADERS) {
      for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === printable && value) {
          process.stderr.write(`< ${name}: ${redactHeaderValue(name, value)}\n`)
        }
      }
    }
  }

  private buildRequestError(response: {
    statusCode: number
    body: string
    headers: Record<string, string>
  }): StripeRequestError {
    let errorType = ''
    let errorCode = ''

    try {
      const parsed = JSON.parse(response.body) as {
        error?: { type?: string; code?: string }
      }
      errorType = parsed.error?.type ?? ''
      errorCode = parsed.error?.code ?? ''
    } catch {
      // body is not JSON
    }

    return new StripeRequestError({
      statusCode: response.statusCode,
      errorType,
      errorCode,
      requestId: response.headers['request-id'] ?? '',
      body: response.body,
    })
  }
}
