import http from 'http'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

import type { Profile } from '../config/config.js'

import { StripeClient } from './client.js'
import { StripeRequestError } from './errors.js'

describe('StripeClient', () => {
  let server: http.Server
  let baseURL: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`)

      if (url.pathname === '/v1/charges') {
        res.setHeader('Request-Id', 'req_test123')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'ch_123', object: 'charge' }))
        return
      }

      if (url.pathname === '/v1/no_content') {
        res.setHeader('Request-Id', 'req_204')
        res.writeHead(204)
        res.end()
        return
      }

      if (url.pathname === '/v1/plain_text') {
        res.setHeader('Request-Id', 'req_plain')
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK')
        return
      }

      if (url.pathname === '/v1/not_found') {
        res.setHeader('Request-Id', 'req_err456')
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            error: { type: 'invalid_request_error', code: 'resource_missing' },
          }),
        )
        return
      }

      if (url.pathname === '/v1/echo_headers') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            authorization: req.headers['authorization'],
            stripe_account: req.headers['stripe-account'],
            stripe_version: req.headers['stripe-version'],
            stripe_context: req.headers['stripe-context'],
            idempotency_key: req.headers['idempotency-key'],
            x_custom: req.headers['x-custom'],
          }),
        )
        return
      }

      if (url.pathname === '/v2/core/events') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            content_type: req.headers['content-type'],
          }),
        )
        return
      }

      res.writeHead(404)
      res.end()
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const addr = server.address()
    if (addr && typeof addr === 'object') {
      baseURL = `http://127.0.0.1:${addr.port}`
    }
  })

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  })

  it('sends a GET request and parses the response', async () => {
    const client = new StripeClient({ auth: 'sk_test_abc', baseURL })
    const resp = await client.get<{ id: string; object: string }>('/v1/charges')
    expect(resp.data.id).toBe('ch_123')
    expect(resp.data.object).toBe('charge')
    expect(resp.requestId).toBe('req_test123')
    expect(resp.statusCode).toBe(200)
  })

  it('handles 204 empty response without throwing', async () => {
    const client = new StripeClient({ auth: 'sk_test_abc', baseURL })
    const resp = await client.delete('/v1/no_content')
    expect(resp.statusCode).toBe(204)
    expect(resp.data).toBeUndefined()
    expect(resp.requestId).toBe('req_204')
  })

  it('handles non-JSON response body without throwing', async () => {
    const client = new StripeClient({ auth: 'sk_test_abc', baseURL })
    const resp = await client.get<string>('/v1/plain_text')
    expect(resp.statusCode).toBe(200)
    expect(resp.data).toBe('OK')
    expect(resp.requestId).toBe('req_plain')
  })

  it('throws StripeRequestError on 4xx', async () => {
    const client = new StripeClient({ auth: 'sk_test_abc', baseURL })
    try {
      await client.get('/v1/not_found')
      expect.fail('should have thrown')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(StripeRequestError)
      const reqErr = err as StripeRequestError
      expect(reqErr.statusCode).toBe(404)
      expect(reqErr.errorType).toBe('invalid_request_error')
      expect(reqErr.errorCode).toBe('resource_missing')
      expect(reqErr.requestId).toBe('req_err456')
    }
  })

  it('sets Stripe-Account header from constructor option', async () => {
    const client = new StripeClient({
      auth: 'sk_test_abc',
      baseURL,
      stripeAccount: 'acct_123',
    })
    const resp = await client.get<{ stripe_account: string }>('/v1/echo_headers')
    expect(resp.data.stripe_account).toBe('acct_123')
  })

  it('sets per-request headers via options', async () => {
    const client = new StripeClient({ auth: 'sk_test_abc', baseURL })
    const resp = await client.get<{ stripe_account: string; idempotency_key: string }>(
      '/v1/echo_headers',
      undefined,
      { stripeAccount: 'acct_456', idempotencyKey: 'idem_789' },
    )
    expect(resp.data.stripe_account).toBe('acct_456')
    expect(resp.data.idempotency_key).toBe('idem_789')
  })

  it('uses JSON content type for v2 paths', async () => {
    const client = new StripeClient({ auth: 'sk_test_abc', baseURL })
    const resp = await client.post<{ content_type: string }>('/v2/core/events')
    expect(resp.data.content_type).toBe('application/json')
  })

  it('sets Stripe-Version header from constructor', async () => {
    const client = new StripeClient({
      auth: 'sk_test_abc',
      baseURL,
      apiVersion: '2024-06-20',
    })
    const resp = await client.get<{ stripe_version: string }>('/v1/echo_headers')
    expect(resp.data.stripe_version).toBe('2024-06-20')
  })

  it('allows callers to override and add headers via options.headers', async () => {
    const client = new StripeClient({
      auth: 'sk_test_abc',
      baseURL,
      apiVersion: '2024-06-20',
    })
    const resp = await client.get<{ stripe_version: string; x_custom: string }>(
      '/v1/echo_headers',
      undefined,
      {
        headers: {
          'Stripe-Version': '2099-01-01',
          'X-Custom': 'hello',
        },
      },
    )
    expect(resp.data.stripe_version).toBe('2099-01-01')
    expect(resp.data.x_custom).toBe('hello')
  })
})

describe('StripeClient with UAT auth', () => {
  let server: http.Server
  let baseURL: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`)

      if (url.pathname === '/v1/echo_headers') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            authorization: req.headers['authorization'],
            stripe_account: req.headers['stripe-account'],
            stripe_context: req.headers['stripe-context'],
            stripe_version: req.headers['stripe-version'],
          }),
        )
        return
      }

      if (url.pathname === '/v2/core/event_destinations') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            authorization: req.headers['authorization'],
            stripe_context: req.headers['stripe-context'],
            content_type: req.headers['content-type'],
          }),
        )
        return
      }

      res.writeHead(404)
      res.end()
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const addr = server.address()
    if (addr && typeof addr === 'object') {
      baseURL = `http://127.0.0.1:${addr.port}`
    }
  })

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  })

  it('sends STRIPE-V2-SIG authorization for UAT auth', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_live',
      },
      baseURL,
    })
    const resp = await client.get<{ authorization: string }>('/v1/echo_headers')
    expect(resp.data.authorization).toBe('STRIPE-V2-SIG keyinfo_live_abc123')
  })

  it('targets live workspace via Stripe-Context', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_live',
      },
      baseURL,
      apiVersion: '2026-04-22.dahlia',
    })
    const resp = await client.get<{ stripe_context: string; stripe_version: string }>(
      '/v1/echo_headers',
    )
    expect(resp.data.stripe_context).toBe('wksp_6OlwMt74SQtyFiRK3qSeJRw')
    expect(resp.data.stripe_version).toBe('2026-04-22.dahlia')
  })

  it('targets sandbox via Stripe-Context with wksp_test_ prefix', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_test_6R2Ech74SQ3XsOsAXxQ1AG8',
        accountId: 'acct_sandbox',
      },
      baseURL,
    })
    const resp = await client.get<{ stripe_context: string }>('/v1/echo_headers')
    expect(resp.data.stripe_context).toBe('wksp_test_6R2Ech74SQ3XsOsAXxQ1AG8')
  })

  it('targets legacy test mode via Stripe-Context', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_test_6TSTeR74SQtyFiReWVpLOIq',
        accountId: 'acct_live',
      },
      baseURL,
    })
    const resp = await client.get<{ stripe_context: string }>('/v1/echo_headers')
    expect(resp.data.stripe_context).toBe('wksp_test_6TSTeR74SQtyFiReWVpLOIq')
  })

  it('works with v2 paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_live',
      },
      baseURL,
      apiVersion: '2026-04-22.dahlia',
    })
    const resp = await client.get<{
      authorization: string
      stripe_context: string
      content_type: string
    }>('/v2/core/event_destinations', { limit: '1' })
    expect(resp.data.authorization).toBe('STRIPE-V2-SIG keyinfo_live_abc123')
    expect(resp.data.stripe_context).toBe('wksp_6OlwMt74SQtyFiRK3qSeJRw')
  })

  it('allows per-request context override', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_live',
      },
      baseURL,
    })
    const resp = await client.get<{ stripe_context: string }>(
      '/v1/echo_headers',
      undefined,
      { stripeContext: 'wksp_test_6R2Ech74SQ3XsOsAXxQ1AG8' },
    )
    expect(resp.data.stripe_context).toBe('wksp_test_6R2Ech74SQ3XsOsAXxQ1AG8')
  })

  it('applies constructor-level stripeAccount for UAT API requests', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_live',
      },
      baseURL,
      stripeAccount: 'acct_connect_target',
    })
    const resp = await client.get<{ stripe_account: string }>('/v1/echo_headers')
    expect(resp.data.stripe_account).toBe('acct_connect_target')
  })
})

describe('StripeClient with UAT auth on /ajax paths', () => {
  let server: http.Server
  let baseURL: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`)

      if (url.pathname === '/ajax/settings/brand') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            cookie: req.headers['cookie'],
            authorization: req.headers['authorization'],
            stripe_account: req.headers['stripe-account'],
            stripe_livemode: req.headers['stripe-livemode'],
            stripe_context: req.headers['stripe-context'],
            stripe_version: req.headers['stripe-version'],
          }),
        )
        return
      }

      res.writeHead(404)
      res.end()
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const addr = server.address()
    if (addr && typeof addr === 'object') {
      baseURL = `http://127.0.0.1:${addr.port}`
    }
  })

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  })

  it('sends UAT as __Host-session cookie for ajax paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ cookie: string }>('/ajax/settings/brand')
    expect(resp.data.cookie).toBe('__Host-session=keyinfo_live_abc123')
  })

  it('does not send Authorization header for ajax paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ authorization: string | undefined }>(
      '/ajax/settings/brand',
    )
    expect(resp.data.authorization).toBeUndefined()
  })

  it('sets Stripe-Account from accountId for ajax paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_account: string }>('/ajax/settings/brand')
    expect(resp.data.stripe_account).toBe('acct_1NRKwLLJDmqA11cn')
  })

  it('sets Stripe-Livemode to true for live workspace', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_livemode: string }>('/ajax/settings/brand')
    expect(resp.data.stripe_livemode).toBe('true')
  })

  it('sets Stripe-Livemode to false for sandbox (wksp_test_ prefix)', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_test_6R2Ech74SQ3XsOsAXxQ1AG8',
        accountId: 'acct_1PsqfLPqp2mVt2wm',
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_livemode: string }>('/ajax/settings/brand')
    expect(resp.data.stripe_livemode).toBe('false')
  })

  it('does not set Stripe-Context for ajax paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_context: string | undefined }>(
      '/ajax/settings/brand',
    )
    expect(resp.data.stripe_context).toBeUndefined()
  })

  it('allows explicit livemode override', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_test_6TSTeR74SQtyFiReWVpLOIq',
        accountId: 'acct_1NRKwLLJDmqA11cn',
        livemode: false,
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_livemode: string; stripe_account: string }>(
      '/ajax/settings/brand',
    )
    expect(resp.data.stripe_livemode).toBe('false')
    expect(resp.data.stripe_account).toBe('acct_1NRKwLLJDmqA11cn')
  })

  it('still sets Stripe-Version for ajax paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
      apiVersion: '2026-04-22.dahlia',
    })
    const resp = await client.post<{ stripe_version: string }>('/ajax/settings/brand')
    expect(resp.data.stripe_version).toBe('2026-04-22.dahlia')
  })

  it('applies constructor-level stripeAccount for ajax paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
      stripeAccount: 'acct_connect_target',
    })
    const resp = await client.post<{ stripe_account: string }>('/ajax/settings/brand')
    expect(resp.data.stripe_account).toBe('acct_connect_target')
  })
})

describe('StripeClient with UAT auth on /graphql paths', () => {
  let server: http.Server
  let baseURL: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          cookie: req.headers['cookie'],
          authorization: req.headers['authorization'],
          stripe_account: req.headers['stripe-account'],
          stripe_livemode: req.headers['stripe-livemode'],
          stripe_context: req.headers['stripe-context'],
          content_type: req.headers['content-type'],
        }),
      )
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const addr = server.address()
    if (addr && typeof addr === 'object') {
      baseURL = `http://127.0.0.1:${addr.port}`
    }
  })

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  })

  it('sends UAT as __Host-auth_token cookie for graphql paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ cookie: string }>('/graphql/myquery')
    expect(resp.data.cookie).toBe('__Host-auth_token=keyinfo_live_abc123')
  })

  it('sets Authorization to bare STRIPE-V2-SIG for graphql paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ authorization: string }>('/graphql/myquery')
    expect(resp.data.authorization).toBe('STRIPE-V2-SIG')
  })

  it('sets Stripe-Context for graphql paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_context: string }>('/graphql/myquery')
    expect(resp.data.stripe_context).toBe('wksp_6OlwMt74SQtyFiRK3qSeJRw')
  })

  it('allows stripeContext override for graphql paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_context: string }>(
      '/graphql/myquery',
      undefined,
      { stripeContext: 'wksp_test_override123' },
    )
    expect(resp.data.stripe_context).toBe('wksp_test_override123')
  })

  it('does not set Stripe-Account or Stripe-Livemode for graphql paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{
      stripe_account: string | undefined
      stripe_livemode: string | undefined
    }>('/graphql/myquery')
    expect(resp.data.stripe_account).toBeUndefined()
    expect(resp.data.stripe_livemode).toBeUndefined()
  })

  it('uses JSON content-type for graphql paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ content_type: string }>('/graphql/myquery')
    expect(resp.data.content_type).toBe('application/json')
  })
})

describe('StripeClient with UAT auth on /manage paths', () => {
  let server: http.Server
  let baseURL: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          cookie: req.headers['cookie'],
          authorization: req.headers['authorization'],
          stripe_account: req.headers['stripe-account'],
          stripe_livemode: req.headers['stripe-livemode'],
          stripe_context: req.headers['stripe-context'],
        }),
      )
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const addr = server.address()
    if (addr && typeof addr === 'object') {
      baseURL = `http://127.0.0.1:${addr.port}`
    }
  })

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  })

  it('sends UAT as __Host-session cookie for manage paths (like ajax)', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ cookie: string }>('/manage/apps/local')
    expect(resp.data.cookie).toBe('__Host-session=keyinfo_live_abc123')
  })

  it('sets Stripe-Account and Stripe-Livemode for manage paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_account: string; stripe_livemode: string }>(
      '/manage/apps/local',
    )
    expect(resp.data.stripe_account).toBe('acct_1NRKwLLJDmqA11cn')
    expect(resp.data.stripe_livemode).toBe('true')
  })

  it('does not set Stripe-Context for manage paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ stripe_context: string | undefined }>(
      '/manage/apps/local',
    )
    expect(resp.data.stripe_context).toBeUndefined()
  })

  it('does not send Authorization header for manage paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
    })
    const resp = await client.post<{ authorization: string | undefined }>(
      '/manage/apps/local',
    )
    expect(resp.data.authorization).toBeUndefined()
  })

  it('applies constructor-level stripeAccount for manage paths', async () => {
    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_abc123',
        context: 'wksp_6OlwMt74SQtyFiRK3qSeJRw',
        accountId: 'acct_1NRKwLLJDmqA11cn',
      },
      baseURL,
      stripeAccount: 'acct_connect_target',
    })
    const resp = await client.post<{ stripe_account: string }>('/manage/apps/local')
    expect(resp.data.stripe_account).toBe('acct_connect_target')
  })
})

describe('StripeClient verbose mode', () => {
  let server: http.Server
  let baseURL: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Request-Id', 'req_verbose_test')
      res.setHeader('Stripe-Version', '2024-06-20')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const addr = server.address()
    if (addr && typeof addr === 'object') {
      baseURL = `http://127.0.0.1:${addr.port}`
    }
  })

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  })

  it('prints request and response headers to stderr', async () => {
    const output: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      output.push(chunk as string)
      return true
    })

    const client = new StripeClient({ auth: 'sk_test_secret', baseURL, verbose: true })
    await client.get('/v1/charges')

    writeSpy.mockRestore()

    const combined = output.join('')
    expect(combined).toContain('> GET')
    expect(combined).toContain('/v1/charges')
    expect(combined).toContain('> Authorization: Bearer [REDACTED]')
    expect(combined).not.toContain('sk_test_secret')
    expect(combined).toContain('< HTTP 200')
    expect(combined).toContain('< request-id: req_verbose_test')
  })

  it('redacts Bearer token in verbose output', async () => {
    const output: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      output.push(chunk as string)
      return true
    })

    const client = new StripeClient({
      auth: 'sk_live_supersecret',
      baseURL,
      verbose: true,
    })
    await client.get('/v1/charges')

    writeSpy.mockRestore()

    const combined = output.join('')
    expect(combined).toContain('Bearer [REDACTED]')
    expect(combined).not.toContain('sk_live_supersecret')
  })

  it('redacts STRIPE-V2-SIG token in verbose output', async () => {
    const output: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      output.push(chunk as string)
      return true
    })

    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_secret_token',
        context: 'wksp_abc',
        accountId: 'acct_x',
      },
      baseURL,
      verbose: true,
    })
    await client.get('/v1/charges')

    writeSpy.mockRestore()

    const combined = output.join('')
    expect(combined).toContain('STRIPE-V2-SIG [REDACTED]')
    expect(combined).not.toContain('keyinfo_live_secret_token')
  })

  it('prints Stripe-Context header in verbose output', async () => {
    const output: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      output.push(chunk as string)
      return true
    })

    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_x',
        context: 'wksp_test_sandbox123',
        accountId: 'acct_x',
      },
      baseURL,
      verbose: true,
    })
    await client.get('/v1/charges')

    writeSpy.mockRestore()

    const combined = output.join('')
    expect(combined).toContain('> Stripe-Context: wksp_test_sandbox123')
  })

  it('redacts __Host-auth_token cookie in verbose output for graphql paths', async () => {
    const output: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      output.push(chunk as string)
      return true
    })

    const client = new StripeClient({
      auth: {
        type: 'uat',
        token: 'keyinfo_live_secret_token',
        context: 'wksp_abc',
        accountId: 'acct_x',
      },
      baseURL,
      verbose: true,
    })
    await client.post('/graphql/myquery')

    writeSpy.mockRestore()

    const combined = output.join('')
    expect(combined).toContain('__Host-auth_token=[REDACTED]')
    expect(combined).not.toContain('keyinfo_live_secret_token')
  })

  it('does not print headers when verbose is false', async () => {
    const writeSpy = vi.spyOn(process.stderr, 'write')

    const client = new StripeClient({ auth: 'sk_test_abc', baseURL })
    await client.get('/v1/charges')

    expect(writeSpy).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })
})

describe('StripeClient with profile-based auth', () => {
  let server: http.Server
  let baseURL: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`)

      if (url.pathname === '/v1/echo_headers') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            authorization: req.headers['authorization'],
            stripe_context: req.headers['stripe-context'],
          }),
        )
        return
      }

      res.writeHead(404)
      res.end()
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const addr = server.address()
    if (addr && typeof addr === 'object') {
      baseURL = `http://127.0.0.1:${addr.port}`
    }
  })

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })
  })

  function mockProfile(overrides: Partial<Profile> = {}): Profile {
    return {
      profileName: 'default',
      getUAT: vi.fn().mockResolvedValue(null),
      getAPIKey: vi.fn().mockResolvedValue('sk_test_mock'),
      getAccountID: vi.fn().mockResolvedValue('acct_mock'),
      getLiveContext: vi.fn().mockReturnValue(null),
      getTestWorkspaceID: vi.fn().mockReturnValue(null),
      ...overrides,
    } as unknown as Profile
  }

  it('resolves API key from profile when no auth provided', async () => {
    const profile = mockProfile({
      getAPIKey: vi.fn().mockResolvedValue('sk_test_from_keychain'),
    })

    const client = new StripeClient({ profile, baseURL })
    const resp = await client.get<{ authorization: string }>('/v1/echo_headers')
    expect(resp.data.authorization).toBe('Bearer sk_test_from_keychain')
  })

  it('resolves UAT from profile when available', async () => {
    const profile = mockProfile({
      getUAT: vi.fn().mockResolvedValue('keyinfo_live_from_keychain'),
      getAccountID: vi.fn().mockResolvedValue('acct_resolved'),
      getTestWorkspaceID: vi.fn().mockReturnValue('wksp_test_auto'),
    })

    const client = new StripeClient({ profile, baseURL })
    const resp = await client.get<{ authorization: string; stripe_context: string }>(
      '/v1/echo_headers',
    )
    expect(resp.data.authorization).toBe('STRIPE-V2-SIG keyinfo_live_from_keychain')
    expect(resp.data.stripe_context).toBe('wksp_test_auto')
  })

  it('passes livemode to profile resolution', async () => {
    const profile = mockProfile({
      getUAT: vi.fn().mockResolvedValue('keyinfo_live_token'),
      getAccountID: vi.fn().mockResolvedValue('acct_live'),
      getLiveContext: vi.fn().mockReturnValue('wksp_live_ctx'),
    })

    const client = new StripeClient({ profile, baseURL, livemode: true })
    const resp = await client.get<{ stripe_context: string }>('/v1/echo_headers')
    expect(resp.data.stripe_context).toBe('wksp_live_ctx')
    expect(profile.getUAT).toHaveBeenCalled()
  })

  it('caches resolved credentials across requests', async () => {
    const getAPIKey = vi.fn().mockResolvedValue('sk_test_cached')
    const profile = mockProfile({ getAPIKey })

    const client = new StripeClient({ profile, baseURL })
    await client.get('/v1/echo_headers')
    await client.get('/v1/echo_headers')
    await client.get('/v1/echo_headers')
    expect(getAPIKey).toHaveBeenCalledTimes(1)
  })

  it('explicit auth takes priority over profile', async () => {
    const profile = mockProfile({
      getAPIKey: vi.fn().mockResolvedValue('sk_test_should_not_be_used'),
    })

    const client = new StripeClient({ auth: 'sk_test_explicit', profile, baseURL })
    const resp = await client.get<{ authorization: string }>('/v1/echo_headers')
    expect(resp.data.authorization).toBe('Bearer sk_test_explicit')
    expect(profile.getAPIKey).not.toHaveBeenCalled()
  })
})

describe('StripeRequestError', () => {
  it('detects expired API key errors', () => {
    const err = new StripeRequestError({
      statusCode: 401,
      errorType: 'authentication_error',
      errorCode: 'api_key_expired',
      requestId: 'req_x',
      body: '{}',
    })
    expect(err.isAPIKeyExpired()).toBe(true)
  })

  it('returns false for non-expired key errors', () => {
    const err = new StripeRequestError({
      statusCode: 401,
      errorType: 'authentication_error',
      errorCode: 'invalid_api_key',
      requestId: 'req_x',
      body: '{}',
    })
    expect(err.isAPIKeyExpired()).toBe(false)
  })
})
