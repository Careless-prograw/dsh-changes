import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

// The parser is lifted from the shipped source so this tests the real code text.
const src = fs.readFileSync('index.js', 'utf8')
const start = src.indexOf('  const parseUnifiedDiff')
const end = src.indexOf('  const vcsChangedFiles')
const factory = new Function(`${src.slice(start, end)}; return parseUnifiedDiff`)
const parseUnifiedDiff = factory()

const wc = process.argv[2]
const run = (args, cwd) => {
  const result = spawnSync('svn', args, { cwd, encoding: 'utf8' })
  // svn writes warnings to stderr and may still exit 0, so keep both streams.
  return { ok: result.status === 0, status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

// 1) A modified file must produce hunks.
const diff = run(['diff', '--non-interactive', 'Weapon.cpp'], wc)
const hunks = parseUnifiedDiff(diff.out)
console.log(`hunks for the modified file: ${hunks.length}`)
for (const hunk of hunks) {
  console.log(`  @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ lines=${hunk.lines.length}`)
  for (const line of hunk.lines) console.log(`     |${line}`)
}
if (hunks.length !== 1) throw new Error('expected exactly one hunk')
if (hunks[0].oldLines !== 5 || hunks[0].newLines !== 6) throw new Error('bad line counts')
const added = hunks[0].lines.filter((line) => line.startsWith('+'))
const removed = hunks[0].lines.filter((line) => line.startsWith('-'))
if (added.length !== 2 || removed.length !== 1) throw new Error(`bad +/- counts ${added.length}/${removed.length}`)

// 2) A directory that is not a working copy must be an error, never "no changes".
const warn = run(['status', '--non-interactive'], process.env.USERPROFILE)
const dialogue = warn.out
const isWarning = /svn: (warning|E\d+)/i.test(dialogue)
console.log(`non-WC status flagged as a warning: ${isWarning}`)
if (!isWarning) throw new Error('non-WC status was not detected as a warning')

console.log('OK: real svn diff parses; non-WC status is an error')
