import fs from 'node:fs'

// The precedence rules for the native-card switch, lifted from the shipped
// source so the table below documents the real behaviour:
//   explicit settings value  -> wins, and refreshes the cache
//   otherwise cached value   -> used (this is what makes a restart reliable)
//   otherwise                -> the card is shown (hide = false)
const source = fs.readFileSync('index.js', 'utf8')
const start = source.indexOf('  /** What the settings document currently says')
const end = source.indexOf('  /** sessionId -> Map<eventSeq, turn>')
if (start < 0 || end < 0) throw new Error('anchors not found')

const build = (configField, cachedStart) => {
  const cached = { prefs: {} }
  if (cachedStart !== undefined) cached.prefs.hideNativeChangesCard = cachedStart
  let saved = 0
  // A volatile field arrives as a cell; a plain boolean arrives as itself.
  const makeField = () => {
    if (configField === undefined) return undefined
    if (typeof configField === 'boolean') return configField
    return { get: () => configField.value }
  }
  const field = makeField()
  const config = field === undefined ? undefined : { hideNativeChangesCard: field }
  const body = source
    .slice(start, end)
    .replace('const cachedPrefs = loadPrefs()', '')
  const factory = new Function(
    'config', 'cachedPrefs', 'savePrefs',
    `${body}; return { readHideNative, configHideNative }`,
  )
  const api = factory(config, cached.prefs, () => { saved += 1 })
  return {
    hide: api.readHideNative(),
    cachedAfter: cached.prefs.hideNativeChangesCard,
    saves: saved,
  }
}

const cases = [
  // [label, config value, cached value, expected hide, expect cache write]
  ['config true, cache absent', true, undefined, true, true],
  ['config false, cache true', false, true, false, true],
  ['config undefined, cache true', undefined, true, true, false],
  ['config undefined, cache false', undefined, false, false, false],
  ['config undefined, cache absent (default show)', undefined, undefined, false, false],
  ['cell true, cache absent', { value: true }, undefined, true, true],
  ['cell false, cache true', { value: false }, true, false, true],
]

let failures = 0
for (const [label, configValue, cachedValue, expectedHide, expectSave] of cases) {
  const result = build(configValue, cachedValue)
  const okHide = result.hide === expectedHide
  const okSave = (result.saves > 0) === expectSave
  const ok = okHide && okSave
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} -> hide=${result.hide} (expected ${expectedHide}), cache=${JSON.stringify(result.cachedAfter)}`)
}

if (failures > 0) throw new Error(`${failures} precedence case(s) failed`)
console.log('OK: settings win, cache survives restarts, absent means shown')
