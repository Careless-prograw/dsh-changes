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

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
console.log(`  version: ${manifest.version}`)
console.log(`  name: ${manifest.name}`)

const host = fs.readFileSync('index.js', 'utf8')
const checks = {
  'persistence store path': host.includes("'dsh-changes', 'state.json'"),
  'loadStore': host.includes('const loadStore = ()'),
  'captureTurn': host.includes('const captureTurn = async'),
  'restore path in diffOf': host.includes('const stored = sessionRecord(sessionId)?.diffs?.[String(entry.seq)]?.[path]'),
  'restoreDecisions': host.includes('restoreDecisions()'),
  'flush on dispose': host.includes("'dsh-changes: persisted state'"),
}
for (const [label, present] of Object.entries(checks)) console.log(`  ${present ? 'ok  ' : 'MISS'} ${label}`)
process.exit(problems === 0 ? 0 : 1)
