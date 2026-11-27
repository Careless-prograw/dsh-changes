/**
 * End-to-end check of the checkpoint rewind ("back to how round N ended").
 *
 * The plugin is activated against a fake Host — a fake change recorder, a fake
 * filesystem, and its own HTTP surface called directly — so the assertions cover
 * both the numbers the panel shows and the bytes on disk:
 *
 *   1. the reported scenario: five rounds, 1..5 files, nothing reviewed, rewind
 *      to round 3 must leave 1+2+3 files pending and drop the other nine;
 *   2. decisions: a rejection made after the checkpoint is redone (its file comes
 *      back), a decision made after the checkpoint is undone, and one made before
 *      it is kept;
 *   3. the dry run writes nothing.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The plugin persists under $DSH_HOME. Point it at a throwaway directory before
// anything loads, so a test run can never touch the user's real review state.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-changes-rewind-'))

const { apply } = await import('../index.js')

const NS = '/dsh-changes'
const cwd = 'C:\\fake-workspace'
/** Absolute path of a workspace file, joined the way the plugin resolves it. */
const abs = (name) => join(cwd, name)

// ------------------------------------------------------------------ fake host

const disk = new Map()
const fakeFs = {
  async resolve(target) {
    return target
  },
  async readText(target) {
    if (!disk.has(target)) throw new Error(`ENOENT: ${target}`)
    return disk.get(target)
  },
  async writeText(target, text) {
    disk.set(target, text)
  },
  async deleteFile(target) {
    disk.delete(target)
  },
}

const summaries = new Map()
const comparisons = new Map()
const recorder = {
  summary(sessionId, seq) {
    return summaries.get(`${sessionId}\u0000${seq}`)
  },
  async diff(sessionId, seq, index) {
    return comparisons.get(`${sessionId}\u0000${seq}`)?.[index]
  },
}

const handlers = new Map()
const routes = []
const ctx = {
  get(service) {
    if (service === 'workspaceChanges') return recorder
    if (service === 'fs') return fakeFs
    if (service === 'webServer') {
      return {
        register(entry) {
          routes.push(entry)
          return () => {}
        },
      }
    }
    return undefined
  },
  on(event, handler) {
    if (!handlers.has(event)) handlers.set(event, [])
    handlers.get(event).push(handler)
    return () => {}
  },
  effect(fn) {
    const dispose = fn()
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
}

apply(ctx, {})

// ------------------------------------------------------------- diff generation

const linesOf = (text) => {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** One hunk between two line arrays, in the shape the recorder reports. */
const hunkOf = (before, after) => {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1
  let tail = 0
  while (
    tail < before.length - head
    && tail < after.length - head
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail += 1
  const removed = before.slice(head, before.length - tail)
  const added = after.slice(head, after.length - tail)
  const context = before.slice(Math.max(0, head - 2), head)
  const start = Math.max(0, head - 2) + 1
  return {
    oldStart: start,
    oldLines: context.length + removed.length,
    newStart: start,
    newLines: context.length + added.length,
    lines: [
      ...context.map((line) => ` ${line}`),
      ...removed.map((line) => `-${line}`),
      ...added.map((line) => `+${line}`),
    ],
  }
}

const comparisonOf = (beforeText, afterText) => {
  const after = linesOf(afterText)
  if (beforeText === undefined) {
    return {
      kind: 'text',
      before: false,
      after: true,
      hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: after.length, lines: after.map((line) => `+${line}`) }],
    }
  }
  return { kind: 'text', before: true, after: true, hunks: [hunkOf(linesOf(beforeText), after)] }
}

// ------------------------------------------------------------------ driving it

/** One agent round: the files it wrote, and the comparison the recorder reports. */
const runRound = async (sessionId, seq, turn, plan) => {
  const files = []
  const diffs = []
  for (const [path, text] of Object.entries(plan)) {
    const absolute = abs(path)
    const before = disk.get(absolute)
    diffs.push(comparisonOf(before, text))
    files.push({ path, display: path, added: 1, deleted: 0 })
    disk.set(absolute, text)
  }
  summaries.set(`${sessionId}\u0000${seq}`, { cwd, turn, files })
  comparisons.set(`${sessionId}\u0000${seq}`, diffs)
  for (const handler of handlers.get('session/event') ?? []) {
    handler({ id: sessionId }, { type: 'workspace/changes', seq, data: { turn } })
  }
  // captureTurn runs on a zero-delay timer, off the event's own stack.
  await new Promise((resolve) => setTimeout(resolve, 10))
}

const act = async (body) => {
  const route = routes.find((entry) => entry.path === `${NS}/act`)
  assert.ok(route !== undefined, 'the act route must be registered')
  const text = JSON.stringify(body)
  const request = {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text, 'utf8')
    },
  }
  let status = 0
  let payload = ''
  const response = {
    writeHead(value) {
      status = value
    },
    end(value) {
      payload = value
    },
  }
  await route.handler(request, response)
  return { status, body: JSON.parse(payload) }
}

const state = async (sessionId) => {
  const route = routes.find((entry) => entry.path === NS)
  assert.ok(route !== undefined, 'the state route must be registered')
  const response = await route.resource({
    url: `http://127.0.0.1${NS}/state?sessionId=${sessionId}`,
    signal: new AbortController().signal,
  })
  return response.json()
}

const count = (files) => {
  const counts = { pending: 0, accepted: 0, rejected: 0, partial: 0 }
  for (const file of files) counts[file.status] = (counts[file.status] ?? 0) + 1
  return counts
}

// ------------------------------------------------- 1. the reported scenario

const FIVE = 'session-five-rounds'
for (const [seq, turn, names] of [
  [101, 1, ['f1.txt']],
  [202, 2, ['f2.txt', 'f3.txt']],
  [303, 3, ['f4.txt', 'f5.txt', 'f6.txt']],
  [404, 4, ['f7.txt', 'f8.txt', 'f9.txt', 'f10.txt']],
  [505, 5, ['f11.txt', 'f12.txt', 'f13.txt', 'f14.txt', 'f15.txt']],
]) {
  const plan = {}
  for (const name of names) plan[name] = `# ${name}\nwritten in round ${turn}\n`
  await runRound(FIVE, seq, turn, plan)
}

const before = await state(FIVE)
assert.equal(before.ok, true)
assert.equal(before.totals.files, 15)
assert.equal(before.totals.pending, 15)
assert.deepEqual(count(before.files), { pending: 15, accepted: 0, rejected: 0, partial: 0 })

const preview = await act({ op: 'rewindPreview', sessionId: FIVE, seq: 303 })
assert.equal(preview.body.ok, true, JSON.stringify(preview.body))
assert.deepEqual(preview.body.statuses, { pending: 6, accepted: 0, rejected: 0, partial: 0 })
assert.equal(preview.body.keep.length, 6)
assert.equal(preview.body.remove.length, 9)
assert.equal(preview.body.exact, true)
// A dry run must be a no-op.
assert.equal(disk.size, 15)
assert.equal((await state(FIVE)).totals.pending, 15)

const rewound = await act({ op: 'rewind', sessionId: FIVE, seq: 303 })
assert.equal(rewound.body.ok, true, JSON.stringify(rewound.body))
assert.equal(rewound.body.statuses.pending, 6)

const after = await state(FIVE)
assert.equal(after.totals.files, 6, 'only the rounds up to the checkpoint remain')
assert.equal(after.totals.pending, 6)
assert.deepEqual(count(after.files), { pending: 6, accepted: 0, rejected: 0, partial: 0 })
for (let index = 7; index <= 15; index += 1) {
  assert.equal(disk.has(abs('f' + index + '.txt')), false, `f${index}.txt should be gone`)
}
for (let index = 1; index <= 6; index += 1) {
  assert.ok(disk.get(abs('f' + index + '.txt'))?.includes(`# f${index}.txt`), `f${index}.txt should survive`)
}

// ------------------------------------------------------- 2. decisions travel

const MIXED = 'session-mixed'
disk.set(abs('base.txt'), 'line A\nline B\nline C\n')
await runRound(MIXED, 111, 1, { 'base.txt': 'line A\nline B step1\nline C\n', 'new1.txt': 'new one\n' })
await runRound(MIXED, 222, 2, { 'new2.txt': 'new two\n' })
await runRound(MIXED, 333, 3, { 'base.txt': 'line A\nline B step3\nline C\nline D\n', 'new3.txt': 'new three\n' })
await runRound(MIXED, 444, 4, { 'new4.txt': 'new four\n' })

// Everything below happens *after* round 3 ended, so the checkpoint must undo it.
const rejected = await act({ op: 'revertFile', sessionId: MIXED, path: 'new1.txt' })
assert.equal(rejected.body.ok, true, JSON.stringify(rejected.body))
assert.equal(disk.has(abs('new1.txt')), false, 'rejecting a creation deletes the file')
assert.equal((await act({ op: 'acceptFile', sessionId: MIXED, path: 'base.txt' })).body.ok, true)
assert.equal((await act({ op: 'acceptFile', sessionId: MIXED, path: 'new4.txt' })).body.ok, true)

const mixedBefore = await state(MIXED)
assert.deepEqual(count(mixedBefore.files), { pending: 2, accepted: 2, rejected: 1, partial: 0 })

const mixedPreview = await act({ op: 'rewindPreview', sessionId: MIXED, seq: 333 })
assert.equal(mixedPreview.body.ok, true, JSON.stringify(mixedPreview.body))
assert.deepEqual(mixedPreview.body.statuses, { pending: 4, accepted: 0, rejected: 0, partial: 0 })
assert.deepEqual(mixedPreview.body.remove, ['new4.txt'])

const mixedRewind = await act({ op: 'rewind', sessionId: MIXED, seq: 333 })
assert.equal(mixedRewind.body.ok, true, JSON.stringify(mixedRewind.body))

const mixedAfter = await state(MIXED)
assert.deepEqual(count(mixedAfter.files), { pending: 4, accepted: 0, rejected: 0, partial: 0 })
assert.equal(disk.get(abs('base.txt')), 'line A\nline B step3\nline C\nline D\n', 'content returns to round 3')
assert.equal(disk.get(abs('new1.txt')), 'new one\n', 'the rejected creation is redone')
assert.equal(disk.has(abs('new4.txt')), false)

// ------------------------------------------------- 3. a decision made before

const KEPT = 'session-kept'
await runRound(KEPT, 11, 1, { 'a.txt': 'a\n', 'b.txt': 'b\n' })
assert.equal((await act({ op: 'acceptFile', sessionId: KEPT, path: 'a.txt' })).body.ok, true)
await runRound(KEPT, 22, 2, { 'c.txt': 'c\n' })

const keptPreview = await act({ op: 'rewindPreview', sessionId: KEPT, seq: 22 })
// The checkpoint is the end of round 2, so `c.txt` is part of it; only the accept
// of `a.txt`, made before that round, survives.
assert.deepEqual(keptPreview.body.statuses, { pending: 2, accepted: 1, rejected: 0, partial: 0 })
const keptRewind = await act({ op: 'rewind', sessionId: KEPT, seq: 22 })
assert.equal(keptRewind.body.ok, true, JSON.stringify(keptRewind.body))
const keptAfter = await state(KEPT)
assert.deepEqual(count(keptAfter.files), { pending: 2, accepted: 1, rejected: 0, partial: 0 }, 'an earlier accept survives')
assert.equal(disk.get(abs('c.txt')), 'c\n', 'a file created by the checkpoint round stays')

// The rewound session keeps working: a later round is listed normally.
await runRound(KEPT, 33, 3, { 'd.txt': 'd\n' })
const keptLater = await state(KEPT)
assert.equal(keptLater.totals.files, 4, 'rounds after the rewind are recorded again')
assert.equal(keptLater.totals.pending, 3)

console.log('OK: rewind restores content, keeps earlier decisions, undoes later ones, and drops later rounds')
