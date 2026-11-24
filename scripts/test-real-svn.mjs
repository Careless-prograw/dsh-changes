import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

// Run the shipped SVN listing logic against a real working copy: same command,
// same parsing, same warning handling as index.js.
const cwd = process.argv[2]
const run = (args) => {
  const result = spawnSync('svn', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: (result.stderr ?? '').split('\n')[0],
  }
}

const started = Date.now()
const status = run(['status', '--non-interactive'])
const elapsed = Date.now() - started
console.log(`svn status: ${elapsed} ms, exit ok=${status.ok}, stdout bytes=${status.stdout.length}`)

const dialogue = `${status.stdout}\n${status.stderr}`
if (/svn: (warning|E\d+)/i.test(dialogue)) {
  const line = dialogue.split('\n').map((item) => item.trim()).find((item) => item.startsWith('svn:')) ?? ''
  console.log(`WARNING treated as error: ${line}`)
  process.exit(1)
}

const files = []
for (const raw of status.stdout.split(/\r?\n/)) {
  if (raw.trim() === '') continue
  const match = /^(.{1,7})\s+(.+?)\r?$/.exec(raw)
  if (match === null) continue
  const code = match[1].trim()
  const path = match[2].trim().replace(/\\/g, '/')
  if (path === '' || code === '') continue
  files.push({ path, status: code.slice(0, 1), untracked: code.startsWith('?') })
}

console.log(`parsed files: ${files.length}`)
const target = files.find((file) => file.path.endsWith('CyLobbyWeapon.cpp'))
console.log(`target file: ${target === undefined ? 'NOT FOUND' : JSON.stringify(target)}`)

const counts = files.reduce((acc, file) => {
  acc[file.status] = (acc[file.status] ?? 0) + 1
  return acc
}, {})
console.log(`by status: ${JSON.stringify(counts)}`)

// The single-file diff for the target must parse into hunks.
const diff = run(['diff', '--non-interactive', target?.path ?? ''])
const src = fs.readFileSync('index.js', 'utf8')
const start = src.indexOf('  const parseUnifiedDiff')
const end = src.indexOf('  const vcsChangedFiles')
const parseUnifiedDiff = new Function(`${src.slice(start, end)}; return parseUnifiedDiff`)()
const hunks = parseUnifiedDiff(diff.stdout)
console.log(`diff for the target: ${hunks.length} hunk(s), ${hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)} line(s)`)
for (const hunk of hunks.slice(0, 3)) {
  console.log(`  @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
}

if (files.length === 0) throw new Error('no files listed')
if (target === undefined) throw new Error('target file not listed')
if (hunks.length === 0) throw new Error('no hunks parsed for the target')
console.log('OK: the real working copy lists files and the target file diffs')
