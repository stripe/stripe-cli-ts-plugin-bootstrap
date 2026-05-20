#!/usr/bin/env node
import path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import {
  uploadOrThrow,
  updatePluginMetadata,
  type PluginAvailability,
} from './util/requests'
import * as core from '@actions/core'
import { readPluginConfig } from './util/config'
import { removeVPrefix } from './util/version'

const BIN_DIR = path.join(process.cwd(), 'bin')
const CONDITIONAL_PLUGINS = new Set(['docs', 'generate', 'health', 'spec'])

/**
 * Platform and architecture mapping for binary paths
 */
function getPlatforms(pluginName: string) {
  return [
    {
      os: 'darwin',
      arch: 'amd64',
      filename: `stripe-cli-${pluginName}-macos-x64`,
    },
    {
      os: 'darwin',
      arch: 'arm64',
      filename: `stripe-cli-${pluginName}-macos-arm64`,
    },
    {
      os: 'linux',
      arch: 'amd64',
      filename: `stripe-cli-${pluginName}-linux-x64`,
    },
    {
      os: 'linux',
      arch: 'arm64',
      filename: `stripe-cli-${pluginName}-linux-arm64`,
    },
    {
      os: 'windows',
      arch: 'amd64',
      filename: `stripe-cli-${pluginName}-win-x64.exe`,
    },
  ]
}

function computeChecksum(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha256')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

function getPluginAvailability(pluginName: string): PluginAvailability {
  const explicitAvailability = process.env.PLUGIN_AVAILABILITY?.trim()

  if (explicitAvailability) {
    if (explicitAvailability === 'conditional' || explicitAvailability === 'public') {
      return explicitAvailability
    }

    throw new Error(
      `Invalid PLUGIN_AVAILABILITY: ${explicitAvailability}. Must be "public" or "conditional".`,
    )
  }

  if (CONDITIONAL_PLUGINS.has(pluginName)) {
    return 'conditional'
  }

  return 'public'
}

async function main() {
  const rawVersion = process.argv[2]

  if (!rawVersion) {
    return core.setFailed('No version passed.')
  }

  const version = removeVPrefix(rawVersion)
  const pluginConfig = readPluginConfig()
  const pluginName = pluginConfig.name
  const availability = getPluginAvailability(pluginName)

  console.log(`Publishing plugin with Admin App metadata: ${pluginName}`)
  console.log(`Version: ${version}`)
  console.log(`Availability: ${availability}`)
  console.log('')

  const filesToUpload: Array<{
    localPath: string
    remotePath: string
    os: string
    arch: string
    checksum: string
  }> = []

  const binaryName = `stripe-cli-${pluginName}`
  const platforms = getPlatforms(pluginName)

  for (const platform of platforms) {
    const localPath = path.join(BIN_DIR, platform.filename)

    if (!fs.existsSync(localPath)) {
      console.warn(`Warning: Binary not found: ${localPath}`)
      console.warn(`Skipping ${platform.os}/${platform.arch}`)
      continue
    }

    const platformPrefix = `${pluginName}/${version}/${platform.os}/${platform.arch}`
    const remotePath = `${platformPrefix}/${binaryName}`
    const checksum = computeChecksum(localPath)

    filesToUpload.push({
      localPath,
      remotePath,
      os: platform.os,
      arch: platform.arch,
      checksum,
    })
  }

  if (filesToUpload.length === 0) {
    return core.setFailed('No files to upload. Make sure binaries are built.')
  }

  console.log(`Uploading ${filesToUpload.length} files:`)
  filesToUpload.forEach(({ localPath, remotePath, checksum }) => {
    console.log(`  ${path.basename(localPath)} -> ${remotePath} (sha256: ${checksum})`)
  })
  console.log('')

  for (const { localPath, remotePath, os, arch, checksum } of filesToUpload) {
    await uploadOrThrow({
      localPath,
      remotePath,
    })

    await updatePluginMetadata({
      pluginName,
      version,
      os,
      arch,
      checksum,
      availability,
    })
  }

  console.log('')
  console.log('🎉 Plugin published successfully!')
}

main().catch(error => {
  core.setFailed(error instanceof Error ? error.message : String(error))
})
