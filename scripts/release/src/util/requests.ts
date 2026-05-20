import axios from 'axios'
import * as fs from 'fs'
import * as core from '@actions/core'

export type PluginAvailability = 'conditional' | 'public'

const getArtifactoryClient = () => {
  if (!process.env.ARTIFACTORY_HOST) {
    core.setFailed(
      "ARTIFACTORY_HOST environment variable is not set. This script is part of Stripe's internal release pipeline and requires ARTIFACTORY_HOST to be configured.",
    )
    throw new Error('ARTIFACTORY_HOST is not set')
  }
  if (!process.env.ARTIFACTORY_REPO && !process.env.DRYRUN_PUBLISH) {
    core.setFailed('No ARTIFACTORY_REPO variable found. Exiting.')
    throw new Error('ARTIFACTORY_REPO is not set')
  }

  const baseURL = `https://${process.env.ARTIFACTORY_HOST}/artifactory/${process.env.ARTIFACTORY_REPO}/`
  const client = axios.create({
    baseURL,
    headers: { Authorization: `Bearer ${process.env.ARTIFACTORY_SECRET?.trim()}` },
  })
  return { client, baseURL }
}

export const upload = async ({
  localPath,
  remotePath,
}: {
  localPath: string
  remotePath: string
}) => {
  const { client, baseURL } = getArtifactoryClient()

  if (fs.statSync(localPath).size === 0) {
    return core.setFailed('Local file is 0 bytes, which looks unexpected. Exiting.')
  }

  if (process.env.DRYRUN_PUBLISH) {
    console.log('[DRYRUN] Uploading local file:')
    console.log(localPath)
    console.log('[DRYRUN] To remote URL:')
    console.log(`${baseURL}${remotePath}`)

    console.log(
      '[DRYRUN] Upload complete; no files actually uploaded because this is a dry run',
    )
    return
  }

  console.log('Uploading local file:')
  console.log(localPath)
  console.log('To remote URL:')
  console.log(`${baseURL}${remotePath}`)

  const payload = fs.readFileSync(localPath)

  await client
    .put(remotePath, payload)
    .then(response => {
      console.log(`Upload success. Response code: ${response.status}`)
    })
    .catch(error => {
      core.setFailed(error)
    })
}

export const uploadOrThrow = async ({
  localPath,
  remotePath,
}: {
  localPath: string
  remotePath: string
}) => {
  const { client, baseURL } = getArtifactoryClient()

  if (fs.statSync(localPath).size === 0) {
    const message = 'Local file is 0 bytes, which looks unexpected. Exiting.'
    core.setFailed(message)
    throw new Error(message)
  }

  if (process.env.DRYRUN_PUBLISH) {
    console.log('[DRYRUN] Uploading local file:')
    console.log(localPath)
    console.log('[DRYRUN] To remote URL:')
    console.log(`${baseURL}${remotePath}`)

    console.log(
      '[DRYRUN] Upload complete; no files actually uploaded because this is a dry run',
    )
    return
  }

  console.log('Uploading local file:')
  console.log(localPath)
  console.log('To remote URL:')
  console.log(`${baseURL}${remotePath}`)

  const payload = fs.readFileSync(localPath)

  try {
    const response = await client.put(remotePath, payload)
    console.log(`Upload success. Response code: ${response.status}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(message)
    throw error
  }
}

export const download = async ({
  localPath,
  remotePath,
}: {
  localPath: string
  remotePath: string
}) => {
  const { client, baseURL } = getArtifactoryClient()

  console.log('Downloading remote URL:')
  console.log(`${baseURL}${remotePath}`)
  console.log('To local file:')
  console.log(localPath)

  const writer = fs.createWriteStream(localPath)

  const response = await client.get(remotePath, {
    responseType: 'stream',
  })

  response.data.pipe(writer)

  writer.on('finish', () => console.log('Download success.'))
  writer.on('error', error => {
    core.setFailed(error)
  })
}

const getStripeAPIClient = () => {
  const apiKey = process.env.STRIPE_API_KEY?.trim()
  const baseURL =
    process.env.STRIPE_API_BASE_URL?.trim() ||
    process.env.STRIPE_API_BASE?.trim() ||
    'https://api.stripe.com'

  if (!apiKey && !process.env.DRYRUN_PUBLISH) {
    core.setFailed(
      'STRIPE_API_KEY environment variable is not set. A Stripe secret key with stripecli_plugin_write permission is required to update plugin metadata.',
    )
    throw new Error('STRIPE_API_KEY is not set')
  }

  const client = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })

  return { client, baseURL }
}

export const updatePluginMetadata = async ({
  pluginName,
  version,
  os,
  arch,
  checksum,
  availability,
}: {
  pluginName: string
  version: string
  os: string
  arch: string
  checksum: string
  availability: PluginAvailability
}) => {
  const { client, baseURL } = getStripeAPIClient()
  const endpoint = '/v1/stripecli/update-plugin-metadata'
  const payload = new URLSearchParams({
    plugin: pluginName,
    version,
    os,
    arch,
    checksum,
    availability,
  })

  if (process.env.DRYRUN_PUBLISH) {
    console.log('[DRYRUN] Updating plugin metadata at:')
    console.log(`${baseURL}${endpoint}`)
    console.log('[DRYRUN] With payload:')
    console.log(
      JSON.stringify(
        {
          plugin: pluginName,
          version,
          os,
          arch,
          checksum,
          availability,
        },
        null,
        2,
      ),
    )
    console.log(
      '[DRYRUN] Plugin metadata update complete; no API request was made because this is a dry run',
    )
    return
  }

  console.log('Updating plugin metadata at:')
  console.log(`${baseURL}${endpoint}`)

  try {
    const response = await client.post(endpoint, payload.toString())
    console.log(`Plugin metadata update success. Response code: ${response.status}`)

    if (response.data?.binary_url) {
      console.log(`Resolved binary URL: ${response.data.binary_url as string}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(message)
    throw error
  }
}
