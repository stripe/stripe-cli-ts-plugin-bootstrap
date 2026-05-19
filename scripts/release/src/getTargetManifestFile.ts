#!/usr/bin/env node
import * as core from '@actions/core'

/**
 * This script is used to get the target manifest filename based on the environment.
 * It will return the production manifest filename if the environment is production,
 * and MANIFEST_FILE environment variable if the environment is dev or unset.
 *
 * Usage:
 *   tsx src/getTargetManifestFile.ts <environment>
 *
 * Example:
 *   tsx src/getTargetManifestFile.ts production
 *   MANIFEST_FILE=plugins-myunreleasedplugin.toml tsx src/getTargetManifestFile.ts
 */

const PRODUCTION_MANIFEST_FILENAME = 'plugins.toml'

const environments = ['dev', 'production'] as const

type Environment = (typeof environments)[number]

function isEnvironment(environment: string): environment is Environment {
  return environments.includes(environment as Environment)
}

function getProductionManifestFilename(): string {
  return PRODUCTION_MANIFEST_FILENAME
}

function getDevManifestFilename(): string {
  const manifestFilename = process.env.MANIFEST_FILE

  if (!manifestFilename) {
    throw new Error('MANIFEST_FILE environment variable is not set.')
  }

  if (manifestFilename === getProductionManifestFilename()) {
    throw new Error(
      `MANIFEST_FILE cannot be the same as the production one: ${manifestFilename}`,
    )
  }

  return manifestFilename
}

function main() {
  const environment = process.argv[2] || 'dev'

  if (!isEnvironment(environment)) {
    return core.setFailed('Invalid environment. Must be "dev" or "production".')
  }

  switch (environment) {
    case 'dev': {
      console.log(getDevManifestFilename())
      break
    }
    case 'production': {
      console.log(getProductionManifestFilename())
      break
    }
    default: {
      return core.setFailed('Invalid environment. Must be "dev" or "production".')
    }
  }
}

try {
  main()
} catch (error) {
  core.setFailed(error instanceof Error ? error.message : String(error))
}
