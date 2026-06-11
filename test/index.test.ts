import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import {
  formatHandshake,
  getPluginYargs,
  registerConfigFlags,
  registerGlobalFlags,
  servePlugin,
  type BaseFlags,
  type ConfigFlags,
  type GlobalFlags,
  type NetworkType,
  type ServeOptions,
  type PluginCommand,
  type VersionedPlugins,
} from '../src/index'

// Mock plugin implementation for testing
class MockPlugin implements PluginCommand {
  async runCommand(_args: string[]): Promise<void> {
    // no-op
  }
}

describe('index:getPluginYargs', () => {
  it('only registers base flags (color, log-level)', () => {
    const yargs = getPluginYargs('testplugin')
    const options = yargs.getOptions()
    const keys = [...options.string, ...options.boolean].filter(
      k => k !== '$0' && k !== '_',
    )
    expect(keys).toContain('color')
    expect(keys).toContain('log-level')
    expect(keys).not.toContain('api-key')
    expect(keys).not.toContain('config')
    expect(keys).not.toContain('device-name')
    expect(keys).not.toContain('project-name')
  })

  it('returns a yargs instance with strict mode and help enabled', async () => {
    const yargs = getPluginYargs('myplugin')
    const help = await yargs.getHelp()
    expect(help).toContain('--color')
    expect(help).toContain('--log-level')
    expect(help).not.toContain('--api-key')
    expect(help).not.toContain('--config')
    expect(help).not.toContain('--device-name')
    expect(help).not.toContain('--project-name')
  })
})

describe('index:registerConfigFlags', () => {
  it('adds config-aware flags to a yargs instance', () => {
    const yargs = registerConfigFlags(getPluginYargs('testplugin'))
    const options = yargs.getOptions()
    const keys = [...options.string, ...options.boolean].filter(
      k => k !== '$0' && k !== '_',
    )
    expect(keys).toContain('api-key')
    expect(keys).toContain('config')
    expect(keys).toContain('device-name')
    expect(keys).toContain('project-name')
    expect(keys).toContain('color')
    expect(keys).toContain('log-level')
  })
})

describe('index:registerGlobalFlags (deprecated)', () => {
  it('registers all flags for backwards compatibility', () => {
    const yargs = registerGlobalFlags(getPluginYargs('testplugin'))
    const options = yargs.getOptions()
    const keys = [...options.string, ...options.boolean].filter(
      k => k !== '$0' && k !== '_',
    )
    expect(keys).toContain('api-key')
    expect(keys).toContain('color')
    expect(keys).toContain('config')
    expect(keys).toContain('device-name')
    expect(keys).toContain('log-level')
    expect(keys).toContain('project-name')
  })
})

describe('index:flag types', () => {
  it('GlobalFlags is the union of BaseFlags and ConfigFlags', () => {
    expectTypeOf<GlobalFlags>().toMatchTypeOf<BaseFlags & ConfigFlags>()
  })

  it('BaseFlags has only color and log-level', () => {
    expectTypeOf<BaseFlags>().toEqualTypeOf<{ color?: string; 'log-level': string }>()
  })

  it('ConfigFlags has api-key, config, device-name, project-name', () => {
    expectTypeOf<ConfigFlags>().toEqualTypeOf<{
      'api-key'?: string
      config?: string
      'device-name'?: string
      'project-name': string
    }>()
  })
})

describe('index:formatHandshake', () => {
  it('produces expected string and type (runtime + type)', () => {
    const s = formatHandshake(1, 2, 'tcp', '127.0.0.1:1234', 'grpc')
    expect(s).toBe('1|2|tcp|127.0.0.1:1234|grpc')
    expectTypeOf(s).toBeString()
  })

  it('supports NetworkType union (type positive)', () => {
    expectTypeOf<NetworkType>().toEqualTypeOf<'tcp' | 'unix'>()
    // @ts-expect-error - invalid network type
    const bad: NetworkType = 'udp'
    void bad
  })
})

describe('index:servePlugin', () => {
  it('starts a server, outputs handshake, and returns address (runtime)', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { server, address, protocolVersion } = await servePlugin({
      versionedPlugins: {
        1: new MockPlugin(),
      },
      address: '127.0.0.1:0',
    })
    expect(typeof address).toBe('string')
    expect(address).toMatch(/^127\.0\.0\.1:\d+$/)
    expect(protocolVersion).toBe(1)
    expect(writeSpy).toHaveBeenCalled()
    const handshake = writeSpy.mock.calls[0][0]
    expect(handshake).toMatch(/^1\|1\|tcp\|127\.0\.0\.1:\d+\|grpc\n$/)
    server.forceShutdown()
    writeSpy.mockRestore()
  })

  it('accepts ServeOptions and returns expected shape (type)', async () => {
    const opts: ServeOptions = {
      versionedPlugins: {
        1: new MockPlugin(),
      },
      address: '127.0.0.1:0',
      networkType: 'tcp',
    }
    const result = await servePlugin(opts)
    expectTypeOf(result).toMatchTypeOf<{
      server: grpc.Server
      address: string
      protocolVersion: number
    }>()
    result.server.forceShutdown()
  })

  it('uses unix: prefix for unix sockets (runtime)', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { server, address } = await servePlugin({
      versionedPlugins: {
        1: new MockPlugin(),
      },
      address: `${process.cwd()}/tmp.sock`,
      networkType: 'unix',
    })
    expect(address.startsWith('unix:')).toBe(true)
    expect(typeof address).toBe('string')
    writeSpy.mockRestore()
    server.forceShutdown()
  })

  it('supports versioned plugins with version negotiation (runtime)', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const versionedPlugins: VersionedPlugins = {
      1: new MockPlugin(),
      2: new MockPlugin(),
      3: new MockPlugin(),
    }

    // Test without CLI version env var - should use highest version
    delete process.env.PLUGIN_PROTOCOL_VERSIONS
    const { server, address, protocolVersion } = await servePlugin({
      versionedPlugins,
      address: '127.0.0.1:0',
    })
    expect(protocolVersion).toBe(3)
    expect(typeof address).toBe('string')
    expect(writeSpy).toHaveBeenCalled()
    const handshake = writeSpy.mock.calls[0][0]
    expect(handshake).toMatch(/^1\|3\|tcp\|127\.0\.0\.1:\d+\|grpc\n$/)
    server.forceShutdown()
    writeSpy.mockRestore()
  })

  it('negotiates protocol version based on CLI supported versions (runtime)', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const versionedPlugins: VersionedPlugins = {
      1: new MockPlugin(),
      2: new MockPlugin(),
      3: new MockPlugin(),
    }

    // CLI supports 1 and 2, plugin supports 1, 2, 3 - should pick 2
    process.env.PLUGIN_PROTOCOL_VERSIONS = '1,2'
    const { server, protocolVersion } = await servePlugin({
      versionedPlugins,
      address: '127.0.0.1:0',
    })
    expect(protocolVersion).toBe(2)
    const handshake = writeSpy.mock.calls[0][0]
    expect(handshake).toMatch(/^1\|2\|tcp\|127\.0\.0\.1:\d+\|grpc\n$/)
    server.forceShutdown()

    // Cleanup
    delete process.env.PLUGIN_PROTOCOL_VERSIONS
    writeSpy.mockRestore()
  })

  it('throws error when no compatible version found (runtime)', async () => {
    const versionedPlugins: VersionedPlugins = {
      1: new MockPlugin(),
      2: new MockPlugin(),
    }

    // CLI only supports version 3, plugin only supports 1 and 2
    process.env.PLUGIN_PROTOCOL_VERSIONS = '3'
    await expect(
      servePlugin({
        versionedPlugins,
        address: '127.0.0.1:0',
      }),
    ).rejects.toThrow('No compatible protocol version found')

    // Cleanup
    delete process.env.PLUGIN_PROTOCOL_VERSIONS
  })

  it('throws error when no plugin versions provided (runtime)', async () => {
    await expect(
      servePlugin({
        versionedPlugins: {},
        address: '127.0.0.1:0',
      }),
    ).rejects.toThrow('No plugin versions provided in versionedPlugins')
  })

  it('rejects invalid protocol argument to formatHandshake (type negative)', () => {
    // @ts-expect-error - protocol must be "grpc" | "netrpc"
    const s = formatHandshake(1, 1, 'tcp', '127.0.0.1:1', 'http')
    void s
  })
})
