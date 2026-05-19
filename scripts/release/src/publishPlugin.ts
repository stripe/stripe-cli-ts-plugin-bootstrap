#!/usr/bin/env node
import path from 'path'
import * as fs from 'fs'
import { upload } from './util/requests'
import * as core from '@actions/core'
import { readPluginConfig } from './util/config'
import { removeVPrefix } from './util/version'

const BIN_DIR = path.join(process.cwd(), 'bin')
const DIST_DIR = path.join(process.cwd(), 'dist')

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

async function main() {
  const rawVersion = process.argv[2]
  const manifestFilename = process.argv[3]

  if (!rawVersion) {
    return core.setFailed('No version passed.')
  }

  if (!manifestFilename) {
    return core.setFailed('No manifest filename passed.')
  }

  const version = removeVPrefix(rawVersion)
  const pluginConfig = readPluginConfig()
  const pluginName = pluginConfig.name

  console.log(`Publishing plugin: ${pluginName}`)
  console.log(`Version: ${version}`)
  console.log('')

  // Build list of files to upload
  const filesToUpload: Array<{ localPath: string; remotePath: string }> = []

  // Standard binary name used for all platforms (differentiated by path only)
  const binaryName = `stripe-cli-${pluginName}`

  // Add binaries for all platforms
  const platforms = getPlatforms(pluginName)
  for (const platform of platforms) {
    const localPath = path.join(BIN_DIR, platform.filename)

    // Check if binary exists
    if (!fs.existsSync(localPath)) {
      console.warn(`Warning: Binary not found: ${localPath}`)
      console.warn(`Skipping ${platform.os}/${platform.arch}`)
      continue
    }

    const platformPrefix = `${pluginName}/${version}/${platform.os}/${platform.arch}`
    const remotePath = `${platformPrefix}/${binaryName}`

    filesToUpload.push({ localPath, remotePath })
  }

  // Add manifest file
  const manifestLocalPath = path.join(DIST_DIR, manifestFilename)
  if (fs.existsSync(manifestLocalPath)) {
    filesToUpload.push({
      localPath: manifestLocalPath,
      remotePath: manifestFilename,
    })
  } else {
    console.warn(`Warning: Manifest file not found: ${manifestLocalPath}`)
  }

  if (filesToUpload.length === 0) {
    return core.setFailed('No files to upload. Make sure binaries are built.')
  }

  console.log(`Uploading ${filesToUpload.length} files:`)
  filesToUpload.forEach(({ localPath, remotePath }) => {
    console.log(`  ${path.basename(localPath)} -> ${remotePath}`)
  })
  console.log('')

  // Upload all files
  for (const { localPath, remotePath } of filesToUpload) {
    await upload({
      localPath,
      remotePath,
    })
  }

  console.log('')
  console.log('🎉 Plugin published successfully!')
}

main()
