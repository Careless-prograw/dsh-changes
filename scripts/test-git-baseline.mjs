import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Mirrors the Git branch of vcsFileDiff / vcsRepoInfo in index.js, using the
// shipped diff parser, so this tests the same behaviour the panel will see.
const cwd = process.argv[2]
const run = (args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const src = fs.readFileSync('index.js', 'utf8')
const start = src.indexOf('  const parseUnifiedDiff')
const end = src.indexOf('  const vcsChangedFiles')
const parseUnifiedDiff = new Function(`${src.slice(start, end)}; return parseUnifiedDiff`)()

const diffOf = (file) => {
  // untracked check, exactly as index.js does it
  const check = run(['status', '--porcelain=v1', '--no-renames', '--', file])
  const untracked = check.ok && check.stdout.split('\n').some((line) => line.startsWith('??'))
  if (untracked) {
    const text = fs.readFileSync(path.join(cwd, file), 'utf8')
    const lines = text.split(/\r?\n/).filter((line, index, all) => !(index === all.length - 1 && line === ''))
    return { mode: 'whole-file add', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((line) => `+${line}`) }] }
  }
  const runDiff = run(['diff', 'HEAD', '--unified=3', '--no-renames', '--', file])
  return { mode: 'git diff HEAD', hunks: parseUnifiedDiff(runDiff.stdout), stderr: runDiff.stderr.trim() }
}

for (const file of ['Tracked.cpp', 'Untouched.cpp', 'Untracked.cpp']) {
  const result = diffOf(file)
  const counts = result.hunks.reduce(
    (acc, hunk) => {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) acc.added += 1
        else if (line.startsWith('-')) acc.removed += 1
      }
      return acc
    },
    { added: 0, removed: 0 },
  )
  console.log(`${file}: ${result.hunks.length} hunk(s) via ${result.mode}, +${counts.added} -${counts.removed}`)
  for (const hunk of result.hunks) {
    console.log(`   @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
  }
}

// vcs-info equivalent
const head = run(['rev-parse', '--short', 'HEAD'])
const branch = run(['rev-parse', '--abbrev-ref', 'HEAD'])
console.log(`info: revision=${head.stdout.trim()} branch=${branch.stdout.trim()}`)

const tracked = diffOf('Tracked.cpp')
const untracked = diffOf('Untracked.cpp')
const untouched = diffOf('Untouched.cpp')
if (tracked.hunks.length === 0) throw new Error('modified tracked file produced no hunks')
if (untracked.mode !== 'whole-file add' || untracked.hunks.length === 0) throw new Error('untracked file did not become a whole-file add')
if (untouched.hunks.length !== 0) throw new Error('untouched file should have no diff against HEAD')
console.log('OK: Git baseline behaves like the SVN one — per file, against the repo base')
