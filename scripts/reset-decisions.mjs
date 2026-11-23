import fs from 'node:fs'
import path from 'node:path'

const sessionId = process.argv[2]
const storeDir = path.join(process.env.DSH_HOME ?? path.join(process.env.USERPROFILE, '.dsh'), 'dsh-changes')
const target = path.join(storeDir, 'state.json')
const store = JSON.parse(fs.readFileSync(target, 'utf8'))
const record = store.sessions?.[sessionId]
if (record === undefined) {
  console.log('no record')
  process.exit(0)
}
const before = Object.keys(record.decisions ?? {}).length
// Clear every decision: a test consumed the real pending batch, and "accept"
// writes nothing to disk, so returning them to pending is lossless.
record.decisions = {}
record.updatedAt = Date.now()
fs.writeFileSync(target, JSON.stringify(store), 'utf8')
console.log(`cleared ${before} decision(s); the session's batches are pending again`)
