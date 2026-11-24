import fs from 'node:fs'

const src = fs.readFileSync('client.js', 'utf8')
const zhStart = src.indexOf('      zh: {')
const enStart = src.indexOf('      en: {')
if (zhStart < 0 || enStart < 0) throw new Error('dict not found')
const zhEnd = src.indexOf('      },', zhStart)
const enEnd = src.indexOf('      },', enStart)
const zhText = src.slice(zhStart, zhEnd)
const enText = src.slice(enStart, enEnd)

const keysOf = (text) => {
  const out = new Set()
  for (const match of text.matchAll(/^\s*'([^']+)':/gm)) out.add(match[1])
  return out
}
const zh = keysOf(zhText)
const en = keysOf(enText)

const missingZh = [...en].filter((key) => !zh.has(key))
const missingEn = [...zh].filter((key) => !en.has(key))

console.log(`zh keys: ${zh.size}   en keys: ${en.size}`)
console.log(`missing in zh (${missingZh.length}): ${missingZh.join(', ') || '-'}`)
console.log(`missing in en (${missingEn.length}): ${missingEn.join(', ') || '-'}`)

// Also: every key the code calls with t('...') must exist in both.
const used = new Set()
for (const match of src.matchAll(/\bt\('([^']+)'/gm)) used.add(match[1])
const usedMissing = [...used].filter((key) => !zh.has(key) || !en.has(key))
console.log(`t() keys used: ${used.size}; missing anywhere: ${usedMissing.join(', ') || '-'}`)

if (missingZh.length > 0 || usedMissing.length > 0) process.exit(1)
console.log('OK: zh and en cover every key the UI uses')
