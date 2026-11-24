import fs from 'node:fs'

const files = [
  'package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'README.md',
  'LICENSE', 'CHANGELOG.md', 'locale/zh.json', 'locale/en.json',
  'docs/DETAIL.md', '.github/workflows/release.yml',
]

let problems = 0
for (const file of files) {
  const bytes = fs.readFileSync(file)
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (bom) { console.log(`  BOM: ${file}`); problems += 1 }
}
console.log(problems === 0 ? '  BOM: clean' : `  BOM: ${problems} file(s)`)

for (const file of ['package.json', 'locale/zh.json', 'locale/en.json']) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'))
    console.log(`  JSON ok: ${file}`)
  } catch (error) {
    console.log(`  JSON FAIL: ${file}: ${error.message}`)
    problems += 1
  }
}

const host = fs.readFileSync('index.js', 'utf8')
const client = fs.readFileSync('client.js', 'utf8')
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
console.log(`  version: ${manifest.version}`)
console.log(`  name: ${manifest.name}`)

const checks = {
  // persistence
  'persistence store path': host.includes("'dsh-changes', 'state.json'"),
  'loadStore': host.includes('const loadStore = ()'),
  'captureTurn': host.includes('const captureTurn = async'),
  'restoreDecisions': host.includes('restoreDecisions()'),
  'flush on dispose': host.includes("'dsh-changes: persisted state'"),
  // merging + single continuous diff
  'files merged by path': host.includes('const byPath = new Map()'),
  'review unit is the newest recording': host.includes('handled: latest?.handled === true'),
  'diff is one continuous list': host.includes('const hunks = diff.hunks.map') && host.includes('originTurn: origin.turn'),
  'annotations never reach a write': !host.includes('dshc-round'),
  // folding
  'file text endpoint exists': host.includes('const buildFileText = async'),
  'file text is bounded': host.includes('MAX_FILE_TEXT_BYTES'),
  // vcs
  'vcs says why it is unavailable': host.includes("code: 'no-vcs'") && host.includes('detected.reason'),
  'git refs command': host.includes("'git', 'log', '-20'"),
}

for (const [label, present] of Object.entries(checks)) {
  console.log(`  ${present ? 'ok  ' : 'MISS'} ${label}`)
  if (!present) problems += 1
}

const clientChecks = {
  'bar uses merged file counts': client.includes('data?.totals') && client.includes("(data?.files ?? [])"),
  'no round badge in the bar': !client.includes("'bar.queueBadge'"),
  'no round chip in the file list': !client.includes("className: 'dshc-rounds'"),
  'one continuous diff body': client.includes("className: 'dshc-diff__body' }, rows"),
  'round tag rides in the hunk header': client.includes("className: 'dshc-hunk__round'"),
  'tag names the change ordinal': client.includes("'panel.roundShort': '第 {count} 次改动'") && client.includes('count: round'),
  'tag hidden for a single change': client.includes('rounds > 1 ? (hunk.round'),
  'turn survives in the tooltip': client.includes('turn: originTurn'),
  'no sticky rows in the diff': !client.includes('position:sticky'),
  'fold bar for unchanged lines': client.includes("className: 'dshc-fold'"),
  'code text keeps primary colour': !client.includes('code-diff-added') && !client.includes('code-diff-deleted'),
  'gutter and sign carry the colour': client.includes('--dshc-marker') && client.includes('dshc-line__sign'),
}
for (const [label, present] of Object.entries(clientChecks)) {
  console.log(`  ${present ? 'ok  ' : 'MISS'} ${label}`)
  if (!present) problems += 1
}

process.exit(problems === 0 ? 0 : 1)
