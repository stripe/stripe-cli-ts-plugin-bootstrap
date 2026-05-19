import axios from 'axios'
import * as fs from 'fs'
import * as core from '@actions/core'

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
