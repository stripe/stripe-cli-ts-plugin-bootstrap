const fs = require('fs')
const path = require('path')

const target = path.join(__dirname, '..', 'temp', '@grpc', 'grpc-js.api.json')

try {
  const text = fs.readFileSync(target, 'utf8')
  const model = JSON.parse(text)

  // Adjust top-level package name and canonical reference
  if (model && typeof model === 'object') {
    if (typeof model.name === 'string') model.name = '@grpc/grpc-js'
    if (typeof model.canonicalReference === 'string')
      model.canonicalReference = '@grpc/grpc-js!'
    if (Array.isArray(model.members)) {
      for (const member of model.members) {
        if (member && member.kind === 'EntryPoint') {
          member.canonicalReference = '@grpc/grpc-js!'
        }
      }
    }
  }

  fs.writeFileSync(target, JSON.stringify(model, null, 2))
  console.log('Renamed dependency doc model to @grpc/grpc-js')
} catch (err) {
  console.error('Failed to rename dependency doc model:', err)
  process.exit(1)
}
