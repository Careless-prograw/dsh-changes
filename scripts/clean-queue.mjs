import fs from 'node:fs'
import path from 'node:path'

const sessionId = process.argv[2]
const storeDir = path.join(process.env.DSH_HOME ?? path.join(process.env.USERPROFILE, '.dsh'), 'dsh-changes')
const target = path.join(storeDir, 'state.json')
if (!fs.existsSync(target)) {
  console.log('no store to clean')
  process.exit(0)
}

const store = JSON.parse(fs.readFileSync(target, 'utf8'))
const record = store.sessions?.[sessionId]
if (record === undefined) {
  console.log('no record for this session')
  process.exit(0)
}

// Drop only what the probe seeded: synthetic sequences and their decisions.
const probeSeqs = new Set([910001, 910002])
const before = record.turns?.length ?? 0
record.turns = (record.turns ?? []).filter((turn) => !probeSeqs.has(turn.seq))
for (const key of Object.keys(record.diffs ?? {})) {
  if (probeSeqs.has(Number(key))) delete record.diffs[key]
}
for (const [key, decision] of Object.entries(record.decisions ?? {})) {
  if (probeSeqs.has(decision?.seq)) delete record.decisions[key]
}
record.updatedAt = Date.now()

fs.writeFileSync(target, JSON.stringify(store), 'utf8')
console.log(`removed ${before - (record.turns?.length ?? 0)} probe batch(es); kept ${record.turns?.length ?? 0}`)
