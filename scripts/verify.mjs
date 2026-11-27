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
  'vcs baseline lists changed files': host.includes('const vcsChangedFiles = async'),
  'vcs baseline diffs one file': host.includes('const vcsFileDiff = async'),
  'unified diff parser': host.includes('const parseUnifiedDiff = (text)'),
  'untracked file is a whole-file add': host.includes('untracked: true'),
  'svn status warning is an error': host.includes('/svn: (warning|E\\d+)/i'),
  'svn status parsed by pattern': host.includes('(.{1,7})'),
  'vcs listing names its base': host.includes('svnWorkingCopyInfo'),
  'CRLF-safe line splitting': host.includes('split(/\\r?\\n/)'),
  'CRLF-safe status regex': host.includes('(.+?)\\r?$'),
  'a handled file settles every hunk': host.includes('const settled = record?.done === true'),
  'switch value is cached': host.includes('prefs.json') && host.includes('loadPrefs'),
  'cache read before services': host.includes('const cachedPrefs = loadPrefs()'),
  'no polling timer': !host.includes('native card re-assert failed'),
  're-applied on boot event': host.includes('app-boot/config-reload'),
  'checkpoints listed': host.includes('const buildCheckpoints = async'),
  'checkpoint rewind exists': host.includes('const rewindTo = async'),
  'rewind is previewed before writing': host.includes("case 'rewindPreview'"),
  'rewind restores the review state': host.includes('const restoreDecisionState ='),
  'review state is snapshotted per round': host.includes('record.statusAt['),
  'rewound rounds stay discarded': host.includes('const isDiscarded ='),
  'a rejection is redone on the way back': host.includes('const redoOne ='),
  'rewind refuses instead of guessing': host.includes("code: 'conflict', dryRun"),
  'rewind stops when a file cannot be restored': host.includes('failures.length > 0'),
  'decision clock is persisted': host.includes('hunksAt'),
  'empty session returns the full shape': host.includes('pendingBatches: 0, files: 0, pending: 0, added: 0, deleted: 0 }'),
  'state reads totals defensively': host.includes('collected.totals?.pending ?? 0'),
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
  'tag hidden for a single change': client.includes('showTag = rounds > 1'),
  'repeated tags deduped': client.includes('ordinal !== lastTagged'),
  'single line-number column': client.includes('dshc-line__no') && !client.includes('row.oldNo'),
  'rows fill the viewport width': client.includes('min-width:100%;width:max-content'),
  'turn survives in the tooltip': client.includes('turn: originTurn'),
  'no sticky rows in the diff': !client.includes('position:sticky'),
  'fold bar for unchanged lines': client.includes("className: 'dshc-fold'"),
  'folds before, between and after hunks': client.includes('pushFold') && client.includes('\'tail\''),
  'file text fetched for fold counts': client.includes('its line count decides'),
  'code text is hue-matched, lightness-shifted': client.includes('color-mix(in srgb, var(--dshc-marker) 58%'),
  'code text never uses a flat diff token': !client.includes('code-diff-added') && !client.includes('code-diff-deleted'),
  'gutter and sign carry the colour': client.includes('--dshc-marker') && client.includes('dshc-line__sign'),
  'baseline swaps the source, not the layout': client.includes('vcs-diff') && client.includes('vcs-info') && client.includes('const files = snapshotFiles') && !client.includes('const refList = h('),
  'vcs baseline is read-only': client.includes('panel.vcsReadOnly'),
  'diff branch guards the loading state': client.includes('if (shown === undefined)'),
  'vcs mode names the comparison base': client.includes('panel.vcsBaseSvn') && client.includes('panel.vcsBaseGit'),
  'bulk buttons follow the pending count': client.includes('pendingCount === 0 || vcsMode'),
  'list shows pending files only': client.includes('const visibleFiles = showHandled ? [...pendingFiles, ...handledFiles] : pendingFiles'),
  'handled files reachable behind a toggle': client.includes('panel.showHandled') && client.includes('setShowHandled'),
  'file rows carry their review state': client.includes("className: 'dshc-file__status'"),
  'rewind confirms with real numbers': client.includes("op: 'rewindPreview'") && client.includes("op: 'rewind'"),
  // A native <select> popup is painted by the OS, so the theme never reaches its
  // items; the panel draws its own list instead.
  'dropdown paints its own list': client.includes("className: 'dshc-dd__menu'"),
  'no native select is left': !client.includes("h(\n            'select'") && !client.includes("'select',"),
  'disabled entries look disabled': client.includes("'data-disabled'") && client.includes('.dshc-dd__item[data-disabled="true"]'),
  'the list hangs off the right edge': client.includes("'data-align': align === 'left' ? 'left' : 'right'"),
  'an unchosen value looks unset': client.includes("'data-placeholder'"),
}
for (const [label, present] of Object.entries(clientChecks)) {
  console.log(`  ${present ? 'ok  ' : 'MISS'} ${label}`)
  if (!present) problems += 1
}

process.exit(problems === 0 ? 0 : 1)
