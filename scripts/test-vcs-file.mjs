import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Exercises the shipped single-file diff path against a real working copy, for a
// session file that IS tracked and for one that is NOT.
const cwd = process.argv[2]
const tracked = 'Source/PMGame/CyWeapon/CyLobbyWeapon.cpp'
const untracked = process.argv[3]

const run = (args) => {
  const result = spawnSync('svn', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const src = fs.readFileSync('index.js', 'utf8')
const start = src.indexOf('  const parseUnifiedDiff')
const end = src.indexOf('  const vcsChangedFiles')
const parseUnifiedDiff = new Function(`${src.slice(start, end)}; return parseUnifiedDiff`)()

// 1) tracked file: svn diff must yield hunks
const diff = run(['diff', '--non-interactive', tracked])
const hunks = parseUnifiedDiff(diff.stdout)
console.log(`tracked: ${hunks.length} hunk(s), ${hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)} line(s), stderr=${JSON.stringify(diff.stderr.trim())}`)
if (hunks.length === 0) throw new Error('tracked file produced no hunks')

// 2) a path svn does not track: the diff command warns, and status marks it "?"
const probe = untracked ?? 'DoesNotExist_Probe.txt'
const udiff = run(['diff', '--non-interactive', probe])
const ustatus = run(['status', '--non-interactive', '--', probe])
const listed = ustatus.stdout.trim().split(/\r?\n/)[0] ?? ''
console.log(`untracked probe "${probe}": status=${JSON.stringify(listed)}, stderr=${JSON.stringify(udiff.stderr.trim())}`)

// 3) the whole-file-add fallback reads the file and prefixes every line
const abs = path.join(cwd, probe)
if (fs.existsSync(abs)) {
  const lines = fs.readFileSync(abs, 'utf8').split('\n')
  console.log(`whole-file add fallback would emit ${lines.length} line(s)`)
}

console.log('OK: single-file VCS diff works for a session file')
