#!/usr/bin/env node
import path from 'path'
import fs from 'fs'
import { download } from './util/requests'
import * as core from '@actions/core'

const DIST_DIR = path.join(process.cwd(), 'dist')

function main() {
  const manifestFilename = process.argv[2]

  if (!manifestFilename) {
    return core.setFailed('No manifest filename passed.')
  }

  console.log(`Downloading remote manifest file: ${manifestFilename}`)

  fs.mkdir(DIST_DIR, { recursive: true }, err => {
    if (err) throw err
  })

  download({
    localPath: `${DIST_DIR}/${manifestFilename}`,
    remotePath: manifestFilename,
  })
}

main()
