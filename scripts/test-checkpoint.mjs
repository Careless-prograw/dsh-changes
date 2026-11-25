/**
 * Verifies the checkpoint unwind with the shipped helpers.
 *
 * Three sequential edits of one file, diffs derived the way the recorder reports
 * them (baseline → that moment), then the same reverse-unwind the plugin performs:
 * from the newest state, reverse each later diff in turn until the target one.
 */
import fs from 'node:fs'

const source = fs.readFileSync('index.js', 'utf8')
const helperStart = source.indexOf('function splitLines')
const helperEnd = source.indexOf('/**\n * Line shift contributed by hunks')
if (helperStart < 0 || helperEnd < 0) throw new Error('helper anchors not found')
const helpers = new Function(`${source.slice(helperStart, helperEnd)}; return { hunkSides, reverseOne }`)()
const { hunkSides, reverseOne } = helpers

// A minimal unified diff between two line arrays (single hunk covering the change).
const diffOf = (before, after) => {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail += 1
  const removed = before.slice(head, before.length - tail)
  const added = after.slice(head, after.length - tail)
  const context = before.slice(Math.max(0, head - 2), head)
  return {
    kind: 'text',
    before: true,
    after: true,
    hunks: [{
      oldStart: Math.max(0, head - 2) + 1,
      oldLines: context.length + removed.length,
      newStart: Math.max(0, head - 2) + 1,
      newLines: context.length + added.length,
      lines: [
        ...context.map((line) => ` ${line}`),
        ...removed.map((line) => `-${line}`),
        ...added.map((line) => `+${line}`),
      ],
    }],
  }
}

// Diffs are supplied newest first, which is the order the plugin unwinds in.
const unwind = (lines, diffsNewestFirst) => {
  let current = [...lines]
  for (const diff of diffsNewestFirst) {
    for (let index = diff.hunks.length - 1; index >= 0; index -= 1) {
      const result = reverseOne(current, diff.hunks[index], 0)
      if (!result.ok) return { ok: false }
      current = result.lines
    }
  }
  return { ok: true, lines: current }
}

// --- the scenario: a plan lands in three steps over the same file ------------
const state0 = ['# 文件', '', 'line A', 'line B', 'line C']
const state1 = ['# 文件', '', 'line A', 'line B step1', 'line C']          // step 1: 改 B
const state2 = ['# 文件', '', 'line A', 'line B step1', 'line C', 'line D'] // step 2: 新增 D
const state3 = ['# 文件', '', 'line A', 'line B step3', 'line C', 'line D'] // step 3: 又改 B（覆盖了 step1 的成果）

// Each recording is baseline → moment; step 3 rewrote what step 1 produced.
const d1 = diffOf(state0, state1)
const d2 = diffOf(state1, state2)
const d3 = diffOf(state2, state3)

// Current file == state3; roll back past step 3 and step 2 => expect state1.
const result = unwind(state3, [d3, d2])
if (!result.ok) throw new Error('unwind refused')
console.log('after unwinding steps 3 and 2:')
for (const line of result.lines) console.log(`  |${line}`)
if (result.lines.join('\n') !== state1.join('\n')) {
  throw new Error(`expected the state after step 1, got:\n${result.lines.join('\n')}`)
}

// Rolling back only step 3 must give state2.
const oneStep = unwind(state3, [d3])
if (!oneStep.ok) throw new Error('unwind of step 3 refused')
if (oneStep.lines.join('\n') !== state2.join('\n')) throw new Error('single-step unwind gave the wrong state')
console.log('one step back gives the state after step 2: ok')

// A recording that does not describe the current content must be refused.
const bogus = diffOf(['unrelated content'], ['other content'])
const refused = unwind(state3, [bogus])
console.log(`foreign diff refused instead of guessing: ${refused.ok === false}`)
if (refused.ok !== false) throw new Error('a non-matching diff was applied')

console.log('OK: checkpoint unwind restores the earlier step exactly, and refuses foreign diffs')
