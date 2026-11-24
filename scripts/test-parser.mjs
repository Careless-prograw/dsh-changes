import fs from 'node:fs'

const src = fs.readFileSync('index.js', 'utf8')
const start = src.indexOf('  const parseUnifiedDiff')
const end = src.indexOf('  const vcsChangedFiles')
if (start < 0 || end < 0) throw new Error('extract failed')
const body = src.slice(start, end).replace('const parseUnifiedDiff = (text) => {', 'const parseUnifiedDiff = (text) => {')
const factory = new Function(`${body}; return parseUnifiedDiff`)
const parseUnifiedDiff = factory()

const sample = [
  'diff --git a/x b/x',
  'index 111..222 100644',
  '--- a/x',
  '+++ b/x',
  '@@ -1,4 +1,5 @@',
  ' a',
  '-b',
  '+B',
  '+B2',
  ' c',
  ' d',
  '@@ -9,2 +10,2 @@',
  '-x',
  '+y',
  '\\ No newline at end of file',
].join('\n')

const hunks = parseUnifiedDiff(sample)
console.log('hunks:', hunks.length)
for (const hunk of hunks) {
  console.log(`  @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@  lines=${hunk.lines.length}`)
  console.log(`     ${JSON.stringify(hunk.lines)}`)
}

// SVN's shape differs only in the preamble.
const svnSample = ['Index: y', '===' + '='.repeat(20), '--- y\t(revision 1)', '+++ y\t(working copy)', '@@ -2 +2 @@', '-old', '+new'].join('\n')
console.log('svn hunks:', parseUnifiedDiff(svnSample).length)

// Counts must be right: 1 hunk with oldLines 4 / newLines 5.
const first = hunks[0]
if (first.oldLines !== 4 || first.newLines !== 5) throw new Error(`bad counts ${first.oldLines}/${first.newLines}`)
if (first.lines.length !== 6) throw new Error(`bad line count ${first.lines.length}`)
const second = hunks[1]
if (second.oldLines !== 2 || second.newLines !== 2) throw new Error('bad second counts')
console.log('OK: parser counts and newline marker handling are correct')
