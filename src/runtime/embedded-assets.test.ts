import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn(() => '/tmp/stripe-plugin-assets-abc123'),
    readFileSync: vi.fn(() => Buffer.from('mock content')),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  }
})

describe('embedded-assets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    delete globalThis.__EMBEDDED_ASSET_MANIFEST__
  })

  afterEach(() => {
    delete globalThis.__EMBEDDED_ASSET_MANIFEST__
  })

  describe('getAssetDir() — dev mode', () => {
    it('returns repo root when no manifest is set', async () => {
      const { getAssetDir } = await import('./embedded-assets.js')
      const result = getAssetDir()
      // In dev mode, should be one directory up from __dirname (which is src/runtime)
      expect(result).toBe(path.resolve(__dirname, '..'))
    })
  })

  describe('getAssetDir() — embedded mode', () => {
    it('extracts all files to a temp directory', async () => {
      globalThis.__EMBEDDED_ASSET_MANIFEST__ = {
        'openapi/spec.yaml': '/bunfs/spec.yaml',
        'sdk-bases/ruby/base.rb': '/bunfs/base.rb',
      }
      const { getAssetDir } = await import('./embedded-assets.js')

      const result = getAssetDir()

      expect(result).toBe('/tmp/stripe-plugin-assets-abc123')
      expect(fs.mkdtempSync).toHaveBeenCalledWith(
        path.join(os.tmpdir(), 'stripe-plugin-assets-'),
      )
      expect(fs.mkdirSync).toHaveBeenCalledTimes(2)
      expect(fs.readFileSync).toHaveBeenCalledTimes(2)
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2)
      expect(fs.readFileSync).toHaveBeenCalledWith('/bunfs/spec.yaml')
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/stripe-plugin-assets-abc123/openapi/spec.yaml',
        expect.anything(),
      )
      expect(fs.readFileSync).toHaveBeenCalledWith('/bunfs/base.rb')
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/stripe-plugin-assets-abc123/sdk-bases/ruby/base.rb',
        expect.anything(),
      )
    })

    it('only extracts once on repeated calls', async () => {
      globalThis.__EMBEDDED_ASSET_MANIFEST__ = {
        'file.txt': '/bunfs/file.txt',
      }
      const { getAssetDir } = await import('./embedded-assets.js')

      const first = getAssetDir()
      const second = getAssetDir()

      expect(first).toBe(second)
      expect(fs.mkdtempSync).toHaveBeenCalledTimes(1)
      expect(fs.readFileSync).toHaveBeenCalledTimes(1)
    })

    it('uses custom temp prefix', async () => {
      globalThis.__EMBEDDED_ASSET_MANIFEST__ = {
        'file.txt': '/bunfs/file.txt',
      }
      const { getAssetDir } = await import('./embedded-assets.js')

      getAssetDir('stripe-generate-assets-')

      expect(fs.mkdtempSync).toHaveBeenCalledWith(
        path.join(os.tmpdir(), 'stripe-generate-assets-'),
      )
    })

    it('registers cleanup on process exit', async () => {
      const onSpy = vi.spyOn(process, 'on')
      globalThis.__EMBEDDED_ASSET_MANIFEST__ = {
        'file.txt': '/bunfs/file.txt',
      }
      const { getAssetDir } = await import('./embedded-assets.js')

      getAssetDir()

      expect(onSpy).toHaveBeenCalledWith('exit', expect.any(Function))
      onSpy.mockRestore()
    })
  })

  describe('resolveAsset()', () => {
    it('joins segments to the asset dir in dev mode', async () => {
      const { resolveAsset, getAssetDir } = await import('./embedded-assets.js')
      const expected = path.join(getAssetDir(), 'openapi', 'spec.yaml')
      expect(resolveAsset('openapi', 'spec.yaml')).toBe(expected)
    })

    it('joins segments to the asset dir in embedded mode', async () => {
      globalThis.__EMBEDDED_ASSET_MANIFEST__ = {
        'openapi/spec.yaml': '/bunfs/spec.yaml',
      }
      const { resolveAsset } = await import('./embedded-assets.js')

      expect(resolveAsset('openapi', 'spec.yaml')).toBe(
        '/tmp/stripe-plugin-assets-abc123/openapi/spec.yaml',
      )
    })
  })
})
