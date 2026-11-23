import fs from 'node:fs'
import path from 'node:path'

const sessionId = process.argv[2]
const storeDir = path.join(process.env.DSH_HOME ?? path.join(process.env.USERPROFILE, '.dsh'), 'dsh-changes')
fs.mkdirSync(storeDir, { recursive: true })

const cwd = 'C:\\Users\\ds.zhang\\Documents\\deepseek-harness\\default-workspace'
const file = (name, seed) => ({
  path: `_research/${name}`,
  display: `_research/${name}`,
  added: seed,
  deleted: 0,
})

const firstBatchFiles = Array.from({ length: 10 }, (_, i) => file(`queue-a-${i + 1}.txt`, i + 1))
const secondBatchFiles = Array.from({ length: 6 }, (_, i) => file(`queue-b-${i + 1}.txt`, 10 - i))

const diffFor = (files) => Object.fromEntries(files.map((entry) => [entry.path, {
  kind: 'text',
  before: false,
  after: true,
  coarse: false,
  hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: entry.added, lines: Array.from({ length: entry.added }, (_, i) => `+${entry.path} line ${i + 1}`) }],
}]))

const store = {
  version: 1,
  sessions: {
    [sessionId]: {
      cwd,
      updatedAt: Date.now(),
      turns: [
        { seq: 910001, turn: 120, files: firstBatchFiles },
        { seq: 910002, turn: 120, files: secondBatchFiles },
      ],
      diffs: {
        910001: diffFor(firstBatchFiles),
        910002: diffFor(secondBatchFiles),
      },
      decisions: {},
    },
  },
}

const target = path.join(storeDir, 'state.json')
fs.writeFileSync(target, JSON.stringify(store), 'utf8')
console.log(`wrote ${target} (${fs.statSync(target).size} bytes)`)
console.log(`batch 1: ${firstBatchFiles.length} files, batch 2: ${secondBatchFiles.length} files, same turn 120`)
