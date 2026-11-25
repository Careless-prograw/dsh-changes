/**
 * Structural check for the UI prototype: every element the script reaches for
 * must exist, and the markup must be balanced enough to render.
 */
import fs from 'node:fs'

const file = process.argv[2] ?? '变更插件-UI原型.html'
const html = fs.readFileSync(file, 'utf8')

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]))
const referenced = new Set([...html.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]))

const missing = [...referenced].filter((id) => !ids.has(id))
console.log(`ids declared: ${ids.size}`)
console.log(`ids referenced: ${referenced.size}`)
console.log(`missing targets: ${missing.length === 0 ? 'none' : missing.join(', ')}`)

// querySelectorAll targets used by the prototype controls
for (const selector of ['.proto [data-bar]', '.proto [data-list]', '.proto [data-base]', '.proto [data-pending]', '.fold', '.pitem', '.hunk']) {
  const names = selector.replace('.proto ', '').replace(/[\[\].]/g, ' ').trim().split(/\s+/)
  console.log(`selector ${selector}: ${html.includes(names[0]) ? 'present' : 'MISSING'}`)
}

// crude balance check on the block elements that matter here
for (const tag of ['div', 'section', 'aside', 'main', 'article', 'select', 'button']) {
  const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length
  const close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
  const selfClosed = (html.match(new RegExp(`<${tag}[^>]*/>`, 'g')) ?? []).length
  const ok = open === close + selfClosed
  console.log(`  ${ok ? 'ok  ' : 'WARN'} <${tag}> open=${open} close=${close}`)
}

// the version this prototype documents
const version = /对应插件 v([\d.]+)/.exec(html)?.[1]
console.log(`documents plugin version: ${version ?? 'NOT STATED'}`)

if (missing.length > 0) throw new Error('script references ids that do not exist')
console.log('OK: every referenced id exists')
