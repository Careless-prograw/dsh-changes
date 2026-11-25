/**
 * Changes（变更）— Host half of the bundle.
 *
 * Aggregates the per-turn workspace change summaries the built-in recorder keeps
 * for live Sessions, tracks the review decision of every listed file, writes
 * rejected hunks back to disk, and exposes Git / SVN baselines plus a
 * whole-workspace rollback.
 *
 * The browser half reaches all of this over loopback HTTP routes registered on
 * `webServer` (the same process the page is served from, so the page's own
 * origin and credentials apply). Written without `@deepseek-ai/*` runtime
 * imports except the dialog-free `schemastery` schema, because a bundle
 * installed from a workspace directory resolves packages from its own
 * `node_modules` rather than from the dsh installation.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Stable Loader identity. */
export const name = 'dsh-changes'

/** The browser carrier; without it the plugin has no surface and stays inert. */
export const inject = ['webServer']

/** Route namespace owned by this bundle. */
const NS = '/dsh-changes'

/** The native package that draws the in-conversation changed-files / delivery cards. */
const TARGET = '@deepseek-ai/dsh-client-ui-deliverables'

export const Config = z.object({
  /**
   * Volatile on purpose: the Plugins page composes a configuration form only
   * from a schema that has at least one volatile field, so this marker is what
   * makes the switch appear at all. It also means editing it applies live — the
   * plugin is not restarted, and the toggle is re-applied on the change event.
   */
  hideNativeChangesCard: z
    .boolean()
    .default(true)
    .volatile()
    .description(
      '隐藏 DSH 原生的会话内「已编辑 N 个文件」变更卡片，让输入框上方的待审条成为唯一的变更提示。'
      + '该卡片与「交付卡片」「正文文件提及」「原生变更审查 tab」同属一个原生包，关闭时会一并隐藏；'
      + '本插件的待审条与右侧「变更」面板不受影响。改动立即生效，停用或卸载本插件会自动恢复原生卡片。',
    ),
})

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

const MAX_BODY_BYTES = 1 << 20
const MAX_STDOUT_BYTES = 1 << 20
const MAX_STDERR_BYTES = 1 << 16
/** Bytes of a changed file the panel may pull to expand unchanged regions. */
const MAX_FILE_TEXT_BYTES = 2 * 1024 * 1024

/** Reply helper for `webServer` resource routes. */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Split text into the lines a unified diff numbers. */
function splitLines(text) {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return { lines, trailingNewline: text.endsWith('\n') }
}

function sameLines(left, right) {
  return left.length === right.length && left.every((line, index) => line === right[index])
}

/**
 * Both sides of one hunk, prefixes removed.
 * Context lines appear on both sides; the recorder prefixes every line with `+`,
 * `-`, or a space.
 */
function hunkSides(hunk) {
  const newSide = []
  const oldSide = []
  for (const line of hunk.lines ?? []) {
    const prefix = line.slice(0, 1)
    const body = line.slice(1)
    if (prefix === '+') newSide.push(body)
    else if (prefix === '-') oldSide.push(body)
    else {
      newSide.push(body)
      oldSide.push(body)
    }
  }
  return { newSide, oldSide }
}

/**
 * Reverse-apply one hunk to `lines` at its recorded position plus `shift`.
 * Refuses — instead of guessing — when the current content no longer matches the
 * recorded turn-end side.
 */
function reverseOne(lines, hunk, shift = 0) {
  const { newSide, oldSide } = hunkSides(hunk)
  const start = hunk.newStart - 1 + shift
  if (start < 0 || start + newSide.length > lines.length) return { ok: false }
  if (!sameLines(lines.slice(start, start + newSide.length), newSide)) return { ok: false }
  return {
    ok: true,
    lines: [...lines.slice(0, start), ...oldSide, ...lines.slice(start + newSide.length)],
  }
}

/**
 * Line shift contributed by hunks already reversed above `target`.
 * Reversing a hunk replaces `newLines` lines with `oldLines`, so every later
 * position in the file moves by that delta.
 */
function shiftFor(hunks, applied, target) {
  let shift = 0
  const position = hunks[target]?.newStart ?? 0
  for (const index of applied) {
    const hunk = hunks[index]
    if (hunk === undefined) continue
    if (hunk.newStart < position || (hunk.newStart === position && index < target)) {
      shift += hunk.oldLines - hunk.newLines
    }
  }
  return shift
}

/** Resolve a recorded path to an absolute host path. */
function absoluteOf(cwd, file) {
  return isAbsolute(file.path) ? file.path : join(cwd, file.path)
}

/**
 * Runtime-only controller for the native deliverables package.
 *
 * The toggle never persists: the entry lives in the composition tree, and
 * committing a change there would rewrite the owning bundle's config file
 * (or the user's profile patch). Swapping the entry's enablement in memory and
 * restoring it on dispose keeps the profile untouched, which is what makes
 * "uninstall leaves no residue" true.
 */
function createNativeCardController(ctx, desiredHide) {
  const state = { entry: undefined, before: false, available: false, applied: false, reason: 'pending' }

  const findEntry = () => {
    const loader = ctx.get('loader')
    if (loader === undefined || typeof loader.entries !== 'function') return undefined
    for (const entry of loader.entries()) {
      if (entry?.options?.name === TARGET) return entry
    }
    return undefined
  }

  const setDisabled = async (entry, disabled) => {
    const tree = entry.parent?.tree
    if (tree === undefined) throw new Error('原生包的条目不可寻址')
    const commit = tree.commit
    // Suppress the persistence path for the duration of this one update.
    tree.commit = () => {}
    try {
      await entry.update(disabled ? { disabled: true } : { disabled: null })
    } finally {
      tree.commit = commit
    }
  }

  return {
    status() {
      const entry = state.entry ?? findEntry()
      return {
        available: state.available,
        applied: state.applied,
        reason: state.reason,
        /** The entry's disable flag as this activation found it — proves the previous dispose restored it. */
        beforeDisabled: state.before,
        /** Live observations, so the toggle is checkable without the page. */
        entryDisabled: entry === undefined ? undefined : Boolean(entry.options?.disabled),
        entryLive: entry === undefined ? undefined : Boolean(entry.fiber?.uid),
      }
    },
    async apply() {
      const hide = desiredHide()
      const entry = findEntry()
      if (entry === undefined) {
        state.reason = 'missing-entry'
        return false
      }
      // The first activation records what to restore; a later re-apply keeps it.
      if (state.entry === undefined) {
        state.entry = entry
        state.before = entry.options?.disabled === undefined ? false : Boolean(entry.options.disabled)
      }
      state.available = true
      try {
        await setDisabled(entry, hide)
        state.applied = true
        state.reason = hide ? 'hidden' : 'shown'
        return true
      } catch (error) {
        state.reason = messageOf(error)
        return false
      }
    },
    async dispose() {
      const entry = state.entry
      if (entry === undefined) return
      state.entry = undefined
      try {
        await setDisabled(entry, state.before)
      } catch {
        // Restoration is best effort: the next composition decides the row.
      }
    },
  }
}

export function apply(ctx, config) {
  /**
   * The live value of the switch. A volatile field arrives as a cell
   * (`.get()`), which is what makes the Plugins page form possible and what
   * lets an edit apply without restarting this plugin.
   */
  const readHideNative = () => {
    const field = config?.hideNativeChangesCard
    if (field !== null && typeof field === 'object' && typeof field.get === 'function') {
      return field.get() !== false
    }
    return field !== false
  }

  /** sessionId -> Map<eventSeq, turn> of every `workspace/changes` event seen. */
  const turns = new Map()
  /** Sessions already back-filled from the durable log. */
  const backfilled = new Set()
  /** `${sessionId}\0${seq}` pairs already copied into the persisted store. */
  const backfilledSeqs = new Set()
  /** `${sessionId}\0${path}` -> { seq, hunks: {idx: 'accept'|'reject'}, done }. */
  const decisions = new Map()
  /** sessionId -> detected version control, probed at most once per Session. */
  const vcsCache = new Map()
  /** Ring buffer of browser-side diagnostics. */
  const debugLines = []

  const log = (text) => {
    debugLines.push(`${new Date().toISOString()} ${text}`)
    if (debugLines.length > 200) debugLines.shift()
  }

  // --------------------------------------------------------------- persistence

  /**
   * The change summaries and hunks this plugin keeps on disk.
   *
   * `workspaceChanges` holds them in the Host process only, so a restart used to
   * erase every pending change. This plugin now snapshots each announced turn —
   * summary plus per-file comparisons — and falls back to that snapshot whenever
   * the live recorder can no longer answer.
   *
   * The location follows the harness convention (`$DSH_HOME`, else `~/.dsh`), so
   * the data sits beside the rest of the user's Harness state.
   */
  const STORE_VERSION = 1
  const MAX_TURNS_PER_SESSION = 20
  const MAX_SESSIONS = 12
  const MAX_STORE_BYTES = 8 * 1024 * 1024
  const MAX_DIFF_BYTES = 512 * 1024

  const storePath = () => {
    const explicit = (process.env.DSH_HOME ?? '').trim()
    const home = explicit === '' ? join(homedir(), '.dsh') : explicit
    return join(home, 'dsh-changes', 'state.json')
  }

  const emptyStore = () => ({ version: STORE_VERSION, sessions: {} })

  const loadStore = () => {
    try {
      const parsed = JSON.parse(readFileSync(storePath(), 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || typeof parsed.sessions !== 'object') return emptyStore()
      return { version: STORE_VERSION, sessions: parsed.sessions ?? {} }
    } catch {
      // Absent, unreadable, or an incompatible shape: start clean rather than
      // failing the plugin.
      return emptyStore()
    }
  }

  const store = loadStore()
  let storeDirty = false
  let flushTimer

  const sessionRecord = (sessionId, create = false) => {
    let record = store.sessions[sessionId]
    if (record === undefined && create) {
      record = { cwd: undefined, updatedAt: 0, turns: [], diffs: {}, decisions: {} }
      store.sessions[sessionId] = record
    }
    return record
  }

  const pruneStore = () => {
    const ids = Object.keys(store.sessions)
    if (ids.length > MAX_SESSIONS) {
      ids
        .sort((left, right) => (store.sessions[left]?.updatedAt ?? 0) - (store.sessions[right]?.updatedAt ?? 0))
        .slice(0, ids.length - MAX_SESSIONS)
        .forEach((id) => delete store.sessions[id])
    }
    for (const record of Object.values(store.sessions)) {
      if (!Array.isArray(record.turns) || record.turns.length <= MAX_TURNS_PER_SESSION) continue
      for (const dropped of record.turns.splice(0, record.turns.length - MAX_TURNS_PER_SESSION)) {
        delete record.diffs?.[String(dropped.seq)]
      }
    }
  }

  const flushStore = () => {
    clearTimeout(flushTimer)
    flushTimer = undefined
    if (!storeDirty) return
    storeDirty = false
    pruneStore()
    const file = storePath()
    try {
      mkdirSync(dirname(file), { recursive: true })
      let text = JSON.stringify(store)
      if (text.length > MAX_STORE_BYTES) {
        // Too big to keep whole: drop the oldest sessions until it fits.
        const ids = Object.keys(store.sessions)
          .sort((left, right) => (store.sessions[left]?.updatedAt ?? 0) - (store.sessions[right]?.updatedAt ?? 0))
        while (text.length > MAX_STORE_BYTES && ids.length > 1) {
          delete store.sessions[ids.shift()]
          text = JSON.stringify(store)
        }
      }
      const temporary = `${file}.tmp`
      writeFileSync(temporary, text, 'utf8')
      renameSync(temporary, file)
    } catch (error) {
      log(`persist failed: ${messageOf(error)}`)
    }
  }

  const scheduleFlush = () => {
    storeDirty = true
    if (flushTimer !== undefined) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      flushStore()
    }, 400)
  }

  /**
   * Snapshot one announced turn — summary plus every file comparison — so the
   * pending list and its hunks survive a Host restart.
   */
  const captureTurn = async (sessionId, seq, turn) => {
    const recorder = ctx.get('workspaceChanges')
    if (recorder === undefined) return
    try {
      const summary = recorder.summary(sessionId, seq)
      if (summary === undefined) return
      const record = sessionRecord(sessionId, true)
      const files = summary.files.map((file) => ({
        path: file.path,
        display: file.display,
        added: file.added,
        deleted: file.deleted,
        ...(file.binary === true ? { binary: true } : {}),
        ...(file.oversized === true ? { oversized: true } : {}),
      }))
      record.cwd = summary.cwd
      record.updatedAt = Date.now()
      const at = record.turns.findIndex((entry) => entry.seq === seq)
      const snapshot = { seq, turn: summary.turn ?? turn, files }
      if (at >= 0) record.turns[at] = snapshot
      else record.turns.push(snapshot)
      record.turns.sort((left, right) => left.seq - right.seq)

      const diffs = {}
      for (let index = 0; index < summary.files.length; index += 1) {
        const file = summary.files[index]
        // A binary or oversized side has no comparable lines, and hunk actions
        // never apply to it, so there is nothing worth storing beyond the kind.
        if (file.binary === true || file.oversized === true) {
          diffs[file.path] = { kind: file.oversized === true ? 'oversized' : 'binary' }
          continue
        }
        try {
          const diff = await recorder.diff(sessionId, seq, index, AbortSignal.timeout(5000))
          if (diff === undefined) continue
          if (diff.kind !== 'text') {
            diffs[file.path] = { kind: diff.kind }
            continue
          }
          const payload = { kind: 'text', before: diff.before, after: diff.after, coarse: diff.coarse === true, hunks: diff.hunks }
          if (JSON.stringify(payload).length <= MAX_DIFF_BYTES) diffs[file.path] = payload
        } catch {
          // Best effort: a file whose comparison cannot be read is still listed.
        }
      }
      record.diffs[String(seq)] = diffs
      scheduleFlush()
    } catch (error) {
      log(`capture failed: ${messageOf(error)}`)
    }
  }

  const persistDecision = (sessionId, record) => {
    const stored = sessionRecord(sessionId, true)
    stored.decisions[`${record.seq}\u0000${record.path}`] = {
      seq: record.seq,
      path: record.path,
      hunks: { ...record.hunks },
      done: record.done === true,
    }
    stored.updatedAt = Date.now()
    scheduleFlush()
  }

  const forgetPersisted = (sessionId) => {
    if (store.sessions[sessionId] === undefined) return
    delete store.sessions[sessionId]
    scheduleFlush()
  }

  // ---------------------------------------------------------------- aggregation

  const recordTurn = (sessionId, seq, turn) => {
    if (!Number.isInteger(seq)) return
    let map = turns.get(sessionId)
    if (map === undefined) {
      map = new Map()
      turns.set(sessionId, map)
    }
    // Every recorded summary is kept: a turn can be recorded more than once
    // (the recorder publishes at turn-stopping and again at turn-end, and a
    // later pass may only describe files touched since), so collapsing events
    // of the same turn would silently drop changes the user never reviewed.
    // Each event is its own review batch instead.
    map.set(seq, turn)
  }

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'workspace/changes') return
    const turn = event.data?.turn ?? 0
    recordTurn(session.id, event.seq, turn)
    // The recorder publishes the summary just after the append, so the snapshot
    // is taken a beat later — and never on the append's own stack.
    setTimeout(() => { void captureTurn(session.id, event.seq, turn) }, 0)
  })

  ctx.on('session/disposed', (session) => {
    turns.delete(session.id)
    backfilled.delete(session.id)
    vcsCache.delete(session.id)
    const prefix = `${session.id}\u0000`
    for (const key of decisions.keys()) {
      if (key.startsWith(prefix)) decisions.delete(key)
    }
    // The Session no longer exists, so its recorded changes are unreachable
    // anyway; keeping them would only grow the file.
    forgetPersisted(session.id)
  })

  /**
   * Recover the events this plugin did not observe — it activates mid-Session,
   * and a config change restarts it — so the panel is not empty until the next
   * turn. Best effort: the durable query is optional.
   */
  const ensureTurns = async (sessionId) => {
    let map = turns.get(sessionId)
    if (map === undefined) {
      map = new Map()
      turns.set(sessionId, map)
    }
    if (backfilled.has(sessionId)) return map
    backfilled.add(sessionId)
    const query = ctx.get('sessionQuery')
    if (query === undefined || typeof query.listEvents !== 'function') return map
    try {
      const events = await query.listEvents(sessionId)
      if (!Array.isArray(events)) return map
      for (const record of events) {
        const type = record?.type ?? record?.event?.type
        if (type !== 'workspace/changes') continue
        const seq = Number.isInteger(record?.seq) ? record.seq : record?.event?.seq
        const turn = record?.data?.turn ?? record?.event?.data?.turn ?? 0
        if (Number.isInteger(seq)) recordTurn(sessionId, seq, turn)
      }
    } catch (error) {
      log(`backfill failed: ${messageOf(error)}`)
    }
    return turns.get(sessionId) ?? map
  }

  /**
   * The review queue: one batch per recorded summary, oldest first.
   *
   * A turn can be recorded more than once, and a later recording may describe
   * only the files changed since. Merging by path (or keeping only the newest
   * recording of a turn) would silently drop changes nobody confirmed, so each
   * recorded summary stays its own batch and the user clears them in order.
   */
  const collect = async (sessionId) => {
    const recorder = ctx.get('workspaceChanges')
    const map = await ensureTurns(sessionId)
    const persisted = sessionRecord(sessionId)

    const live = new Map()
    let cwd
    let latestTurn = 0
    let anyLive = false
    if (recorder !== undefined) {
      for (const [seq, seqTurn] of [...map.entries()].sort((left, right) => left[0] - right[0])) {
        const summary = recorder.summary(sessionId, seq)
        if (summary === undefined) continue
        anyLive = true
        cwd = summary.cwd
        if (Number.isInteger(summary.turn)) latestTurn = Math.max(latestTurn, summary.turn)
        live.set(seq, { turn: summary.turn ?? seqTurn, files: summary.files })
      }
    }

    const stored = new Map()
    for (const entry of persisted?.turns ?? []) {
      if (!Number.isInteger(entry?.seq) || !Array.isArray(entry.files)) continue
      stored.set(entry.seq, entry)
    }

    // Backfill the store from live summaries this Host still holds — turns that
    // happened before this plugin (re)activated have no event left to hook.
    for (const [seq, summary] of live) {
      if (stored.has(seq) || backfilledSeqs.has(`${sessionId}\u0000${seq}`)) continue
      backfilledSeqs.add(`${sessionId}\u0000${seq}`)
      void captureTurn(sessionId, seq, summary.turn)
    }

    const seqs = [...new Set([...live.keys(), ...stored.keys()])].sort((left, right) => left - right)
    if (seqs.length === 0) {
      if (recorder === undefined) {
        return { ok: false, code: 'no-recorder', error: '变更记录器不可用（workspaceChanges 未挂载）' }
      }
      return { ok: true, cwd: undefined, turn: 0, batches: [], files: [] }
    }

    const batches = []
    let restoredAny = false
    for (const seq of seqs) {
      const fromLive = live.get(seq)
      const source = fromLive ?? stored.get(seq)
      if (source === undefined) continue
      const restored = fromLive === undefined
      if (restored) restoredAny = true
      const seqTurn = source.turn
      if (Number.isInteger(seqTurn)) latestTurn = Math.max(latestTurn, seqTurn)
      const files = source.files.map((file, index) => {
        const record = decisionOf(sessionId, seq, file.path)
        return {
          path: file.path,
          display: file.display,
          added: file.added,
          deleted: file.deleted,
          binary: file.binary === true,
          oversized: file.oversized === true,
          index,
          handled: record !== undefined && record.done === true,
          hunks: record?.hunks ?? {},
        }
      })
      const pendingFiles = files.filter((file) => !file.handled)
      batches.push({
        seq,
        turn: seqTurn,
        restored,
        files,
        pending: pendingFiles.length,
        totals: {
          files: files.length,
          pending: pendingFiles.length,
          added: pendingFiles.reduce((sum, file) => sum + (Number.isFinite(file.added) ? file.added : 0), 0),
          deleted: pendingFiles.reduce((sum, file) => sum + (Number.isFinite(file.deleted) ? file.deleted : 0), 0),
        },
      })
    }

    if (cwd === undefined && typeof persisted?.cwd === 'string' && persisted.cwd !== '') cwd = persisted.cwd
    if (cwd === undefined) {
      if (recorder === undefined) {
        return { ok: false, code: 'no-recorder', error: '变更记录器不可用（workspaceChanges 未挂载）' }
      }
      return { ok: false, code: 'stale', error: '本会话的改动汇总已失效' }
    }

    // The queue the bar shows: batches still holding unconfirmed files, oldest
    // first, so the earliest unreviewed change is the one in front.
    const queue = batches.filter((batch) => batch.pending > 0)

    // Merged view: one review unit per path.
    //
    // A file is reviewed once, against the newest recording that touched it:
    // each recording compares the same turn baseline to the state at that
    // moment, so the newest one already contains every earlier change. Older
    // recordings are kept only to say which round first introduced a hunk.
    const byPath = new Map()
    for (const batch of batches) {
      for (const file of batch.files) {
        let merged = byPath.get(file.path)
        if (merged === undefined) {
          merged = {
            path: file.path,
            display: file.display,
            binary: false,
            oversized: false,
            parts: [],
          }
          byPath.set(file.path, merged)
        }
        merged.binary = merged.binary || file.binary === true
        merged.oversized = merged.oversized || file.oversized === true
        merged.parts.push({
          seq: batch.seq,
          turn: batch.turn,
          added: file.added,
          deleted: file.deleted,
          handled: file.handled === true,
          restored: batch.restored === true,
        })
      }
    }

    const files = [...byPath.values()].map((merged) => {
      const latest = merged.parts[merged.parts.length - 1]
      return {
        path: merged.path,
        display: merged.display,
        binary: merged.binary,
        oversized: merged.oversized,
        // Counts describe the newest recording, the closest reading of what the
        // file holds now; summing parts would count the same lines twice.
        added: latest?.added ?? 0,
        deleted: latest?.deleted ?? 0,
        seq: latest?.seq,
        turn: latest?.turn,
        parts: merged.parts,
        // One review unit: the file is handled once its newest change set is.
        handled: latest?.handled === true,
      }
    }).sort((left, right) => (left.display < right.display ? -1 : left.display > right.display ? 1 : 0))

    const pendingFiles = files.filter((file) => !file.handled)
    return {
      ok: true,
      cwd,
      turn: latestTurn,
      batches,
      queue,
      front: queue[0],
      files,
      restored: restoredAny,
      live: anyLive,
      totals: {
        batches: batches.length,
        pendingBatches: queue.length,
        files: files.length,
        pending: pendingFiles.length,
        added: pendingFiles.reduce((sum, file) => sum + (Number.isFinite(file.added) ? file.added : 0), 0),
        deleted: pendingFiles.reduce((sum, file) => sum + (Number.isFinite(file.deleted) ? file.deleted : 0), 0),
      },
    }
  }

  // ------------------------------------------------------------------ decisions

  /**
   * One decision per (batch, file). The batch is the recorded summary's
   * sequence, so the same path changed in two batches carries two independent
   * decisions instead of one overwriting the other.
   */
  const decisionKey = (sessionId, seq, path) => `${sessionId}\u0000${seq}\u0000${path}`

  /** Restore the decisions a previous Host process persisted. */
  const restoreDecisions = () => {
    let restored = 0
    for (const [sessionId, record] of Object.entries(store.sessions)) {
      for (const decision of Object.values(record?.decisions ?? {})) {
        if (!Number.isInteger(decision?.seq) || typeof decision.path !== 'string') continue
        decisions.set(decisionKey(sessionId, decision.seq, decision.path), {
          seq: decision.seq,
          path: decision.path,
          hunks: decision.hunks ?? {},
          done: decision.done === true,
        })
        restored += 1
      }
    }
    if (restored > 0) log(`restored ${restored} decision(s) from disk`)
  }

  /** The decision for one file of one batch. */
  const decisionOf = (sessionId, seq, path) =>
    decisions.get(decisionKey(sessionId, seq, path))

  const freshDecision = (sessionId, seq, path) => {
    const key = decisionKey(sessionId, seq, path)
    const existing = decisions.get(key)
    if (existing !== undefined) return existing
    const record = { seq, path, hunks: {}, done: false }
    decisions.set(key, record)
    return record
  }

  const clearSession = (sessionId) => {
    turns.delete(sessionId)
    backfilled.delete(sessionId)
    vcsCache.delete(sessionId)
    const prefix = `${sessionId}\u0000`
    for (const key of decisions.keys()) {
      if (key.startsWith(prefix)) decisions.delete(key)
    }
    // A whole-area rollback re-points the workspace at a version, so the
    // recorded changes no longer describe it.
    forgetPersisted(sessionId)
  }

  // ----------------------------------------------------------------- file writes

  const filesystem = () => {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('文件服务不可用')
    return fs
  }

  /**
   * The sandbox policy of the Session that owns the change.
   *
   * The filesystem backend fences every mutation by a per-call policy and, with
   * none, falls back to the host process cwd — which is not this Session's
   * workspace, so a revert would be denied. Resolving for the Session fences it
   * by exactly the same boundary as the agent's own edits: a revert can never
   * write somewhere the Session itself could not.
   */
  const policyFor = (sessionId) => {
    const sandboxPolicy = ctx.get('sandboxPolicy')
    if (sandboxPolicy === undefined) return undefined
    try {
      const session = ctx.get('agents')?.get(sessionId)?.session
      return sandboxPolicy.resolve(session === undefined ? {} : { session })
    } catch {
      return undefined
    }
  }

  const readTextAt = async (absolute, signal) => {
    const fs = filesystem()
    const target = await fs.resolve(absolute, { signal })
    return fs.readText(target, signal)
  }

  const writeTextAt = async (absolute, text, signal, sessionId) => {
    const fs = filesystem()
    const target = await fs.resolve(absolute, { signal })
    // Intent and signal precede the policy, per the backend's signature.
    await fs.writeText(target, text, undefined, signal, policyFor(sessionId))
  }

  /** Remove a file the turn created, so a reverted creation leaves nothing behind. */
  const deleteAt = async (absolute, signal, sessionId) => {
    const fs = filesystem()
    const target = await fs.resolve(absolute, { signal })
    await fs.deleteFile(target, undefined, signal, policyFor(sessionId))
  }

  // An empty line list means the recorded side held no lines at all, so the
  // file ends up empty rather than holding a single newline.
  const renderText = (lines, trailingNewline) => lines.length === 0 ? '' : lines.join('\n') + (trailingNewline ? '\n' : '')

  /**
   * One file's comparison inside one batch.
   * @param seq - the batch (a recorded summary's sequence); omitted means the
   *   newest batch that touched this path.
   */
  const diffOf = async (sessionId, seq, path, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    const batch = seq === undefined
      ? [...collected.batches].reverse().find((candidate) => candidate.files.some((file) => file.path === path))
      : collected.batches.find((candidate) => candidate.seq === seq)
    if (batch === undefined) return { ok: false, code: 'no-batch', error: '该批次已不存在' }
    const file = batch.files.find((candidate) => candidate.path === path)
    if (file === undefined) return { ok: false, code: 'no-file', error: '该文件已不在这一批改动中' }

    // Live comparison first; the persisted snapshot answers after a restart,
    // when this Host process no longer holds the recorder's copies.
    const recorder = ctx.get('workspaceChanges')
    if (recorder !== undefined && recorder.summary(sessionId, batch.seq) !== undefined) {
      const diff = await recorder.diff(sessionId, batch.seq, file.index, signal)
      if (diff !== undefined) return { ok: true, collected, batch, file, diff, restored: false }
    }
    const stored = sessionRecord(sessionId)?.diffs?.[String(batch.seq)]?.[path]
    if (stored !== undefined) {
      return { ok: true, collected, batch, file, diff: stored, restored: true }
    }
    return { ok: false, code: 'no-diff', error: '差异不可用（会话可能已释放）' }
  }

  /** Reverse-apply every hunk of one file in one batch, bottom-up, and write it. */
  const revertWholeFile = async (sessionId, batch, file, cwd, signal) => {
    const found = await diffOf(sessionId, batch.seq, file.path, signal)
    if (!found.ok) return found
    const diff = found.diff
    if (diff.kind !== 'text') {
      return { ok: false, code: 'unsupported', error: diff.kind === 'binary' ? '二进制文件无法撤销' : '文件过大，无法撤销' }
    }
    const absolute = absoluteOf(cwd, file)
    let lines
    let trailingNewline
    try {
      const current = await readTextAt(absolute, signal)
      const split = splitLines(current)
      lines = split.lines
      trailingNewline = split.trailingNewline
    } catch (error) {
      return { ok: false, code: 'read-failed', error: `读取失败：${messageOf(error)}` }
    }
    for (let index = diff.hunks.length - 1; index >= 0; index -= 1) {
      const result = reverseOne(lines, diff.hunks[index], 0)
      if (!result.ok) {
        return {
          ok: false,
          code: 'conflict',
          error: `文件已漂移：第 ${index + 1} 块与记录不一致，已停止撤销`,
        }
      }
      lines = result.lines
    }
    try {
      if (diff.hunks.length > 0) await writeTextAt(absolute, renderText(lines, trailingNewline), signal, sessionId)
    } catch (error) {
      return { ok: false, code: 'write-failed', error: `写入失败：${messageOf(error)}` }
    }
    // A creation has no turn-start content: undoing it removes the file rather
    // than leaving an empty one behind.
    if (diff.before === false) {
      try {
        await deleteAt(absolute, signal, sessionId)
      } catch (error) {
        return { ok: false, code: 'write-failed', error: `删除新建文件失败：${messageOf(error)}` }
      }
    }
    const record = freshDecision(sessionId, batch.seq, file.path)
    record.done = true
    record.file = 'reject'
    persistDecision(sessionId, record)
    return { ok: true, path: file.path, hunks: diff.hunks.length }
  }

  // ------------------------------------------------------------------------ vcs

  const runCommand = async (cwd, argv, signal) => {
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) return { ok: false, error: '子进程服务不可用' }
    if (typeof cwd !== 'string' || cwd === '') return { ok: false, error: '会话没有工作目录' }
    let handle
    try {
      handle = subprocess.spawn({
        argv,
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: MAX_STDOUT_BYTES },
          stderr: { maxBytes: MAX_STDERR_BYTES },
        },
        graceMs: 5000,
        signal,
        env: {
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_PAGER: 'cat',
          SVN_EDITOR: '',
          LC_ALL: 'C',
        },
      })
    } catch (error) {
      return { ok: false, error: `${argv[0]} 无法启动：${messageOf(error)}` }
    }
    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      return { ok: false, error: `${argv[0]} 执行失败：${messageOf(error)}` }
    }
    const stdout = handle.collected?.stdout?.readFrom(0)?.text ?? ''
    const stderr = handle.collected?.stderr?.readFrom(0)?.text ?? ''
    // A tool's stderr can be a usage dump; the panel shows one readable line.
    const firstLine = stderr.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? ''
    const failure = firstLine === ''
      ? `${argv[0]} 退出码 ${outcome.exitCode}`
      : firstLine.length > 300 ? `${firstLine.slice(0, 300)}…` : firstLine
    return {
      ok: outcome.exitCode === 0,
      stdout,
      stderr,
      error: outcome.exitCode === 0 ? undefined : failure,
    }
  }

  const detectVcs = async (sessionId, cwd, signal) => {
    if (cwd === undefined) return { kind: null, reason: '会话还没有工作目录' }
    const cached = vcsCache.get(sessionId)
    if (cached !== undefined) return cached
    let result = { kind: null, reason: '未检测到 Git 或 SVN' }
    const git = await runCommand(cwd, ['git', 'rev-parse', '--is-inside-work-tree'], signal)
    if (git.ok && git.stdout.trim() === 'true') {
      result = { kind: 'git', reason: undefined }
    } else {
      const svn = await runCommand(cwd, ['svn', 'info', '--non-interactive'], signal)
      if (svn.ok) result = { kind: 'svn', reason: undefined }
      else if (git.error !== undefined && git.error.includes('无法启动')) result = { kind: null, reason: '未安装 git / svn' }
      else result = { kind: null, reason: '当前工作目录不是版本控制仓库' }
    }
    vcsCache.set(sessionId, result)
    return result
  }

  const parseGitRefs = (stdout) =>
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const [id = '', date = '', author = '', ...rest] = line.split('\t')
        return { id, date, author, label: rest.join(' ') }
      })
      .filter((ref) => ref.id !== '')

  const parseSvnRefs = (stdout) => {
    const refs = []
    let current
    for (const line of stdout.split('\n')) {
      const head = /^r(\d+) \| ([^|]+) \| ([^|]+) \|/.exec(line)
      if (head !== null) {
        current = { id: head[1], author: head[2].trim(), date: head[3].trim(), label: '' }
        refs.push(current)
        continue
      }
      if (current !== undefined && line.trim() !== '' && !line.startsWith('---')) {
        current.label = current.label === '' ? line.trim() : `${current.label} ${line.trim()}`
      }
    }
    return refs
  }

  const listRefs = async (sessionId, kind, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    const detected = await detectVcs(sessionId, collected.cwd, signal)
    // An explicitly requested kind still needs a repository: without one, say so
    // in the user's terms instead of surfacing a raw `fatal: not a git
    // repository`, which reads as a plugin failure rather than a fact.
    if (detected.kind === null) {
      return { ok: false, code: 'no-vcs', error: detected.reason ?? '当前工作目录不是版本控制仓库' }
    }
    const chosen = kind ?? detected.kind
    if (chosen !== detected.kind) {
      return {
        ok: false,
        code: 'no-vcs',
        error: `当前工作目录是 ${detected.kind.toUpperCase()} 仓库，不能用作 ${String(chosen).toUpperCase()} 基线`,
      }
    }
    if (chosen === 'git') {
      const run = await runCommand(
        collected.cwd,
        ['git', 'log', '-20', '--date=short', '--pretty=format:%h%x09%ad%x09%an%x09%s'],
        signal,
      )
      if (!run.ok) return { ok: false, code: 'git-failed', error: run.error }
      return { ok: true, kind: 'git', refs: parseGitRefs(run.stdout) }
    }
    const run = await runCommand(collected.cwd, ['svn', 'log', '-l', '20', '--non-interactive'], signal)
    if (!run.ok) return { ok: false, code: 'svn-failed', error: run.error }
    return { ok: true, kind: 'svn', refs: parseSvnRefs(run.stdout) }
  }

  /** Files a reference would change, as the left column of a VCS baseline shows them. */
  const refFiles = async (sessionId, kind, ref, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    if (kind === 'git') {
      const run = await runCommand(collected.cwd, ['git', 'diff', '--name-status', '--no-renames', ref], signal)
      if (!run.ok) return { ok: false, code: 'git-failed', error: run.error }
      const files = run.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => {
          const [status = '', ...rest] = line.split('\t')
          return { status, display: rest.join('\t') }
        })
      return { ok: true, kind, ref, files }
    }
    const run = await runCommand(collected.cwd, ['svn', 'diff', '--summarize', '-r', `${ref}`], signal)
    if (!run.ok) return { ok: false, code: 'svn-failed', error: run.error }
    const files = run.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const [status = '', ...rest] = line.split(/\s+/)
        return { status, display: rest.join(' ') }
      })
    return { ok: true, kind, ref, files }
  }

  /**
   * What a VCS baseline is actually comparing against: the repository URL and the
   * base revision. Shown so an empty list is diagnosable instead of opaque.
   */
  const svnWorkingCopyInfo = async (cwd, signal) => {
    const run = await runCommand(cwd, ['svn', 'info', '--non-interactive'], signal)
    if (!run.ok) return undefined
    const pick = (name) => {
      const line = run.stdout.split('\n').find((item) => item.startsWith(`${name}:`))
      return line === undefined ? undefined : line.slice(name.length + 1).trim()
    }
    return { url: pick('URL'), revision: pick('Revision'), root: pick('Working Copy Root Path') }
  }

  const gitRepoInfo = async (cwd, signal) => {
    const head = await runCommand(cwd, ['git', 'rev-parse', '--short', 'HEAD'], signal)
    const branch = await runCommand(cwd, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], signal)
    return {
      branch: branch.ok ? branch.stdout.trim() : undefined,
      revision: head.ok ? head.stdout.trim() : undefined,
    }
  }

  /**
   * Parse unified diff text into hunks.
   *
   * Both `git diff` and `svn diff` emit the same shape, so one parser serves the
   * two baselines. Lines before the first `@@` header (file names, index lines)
   * are skipped, and a `\ No newline at end of file` marker is dropped because it
   * is not a line of content.
   */
  const parseUnifiedDiff = (text) => {
    const hunks = []
    let current
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('@@')) {
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
        if (match === null) continue
        current = {
          oldStart: Number(match[1]),
          oldLines: match[2] === undefined ? 1 : Number(match[2]),
          newStart: Number(match[3]),
          newLines: match[4] === undefined ? 1 : Number(match[4]),
          lines: [],
        }
        hunks.push(current)
        continue
      }
      if (current === undefined) continue
      if (line.startsWith('\\')) continue
      if (line === '' ) continue
      const head = line[0]
      if (head !== '+' && head !== '-' && head !== ' ') continue
      current.lines.push(line)
    }
    return hunks
  }

  /** Just the repository identity, for the "compared with …" line. */
  const vcsRepoInfo = async (sessionId, kind, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    if (collected.cwd === undefined) return { ok: false, code: 'no-cwd', error: '会话没有工作目录' }
    const detected = await detectVcs(sessionId, collected.cwd, signal)
    if (detected.kind === null) {
      return { ok: false, code: 'no-vcs', error: detected.reason ?? '当前工作目录不是版本控制仓库' }
    }
    const chosen = kind ?? detected.kind
    if (chosen !== detected.kind) {
      return { ok: false, code: 'no-vcs', error: `当前工作目录是 ${detected.kind.toUpperCase()} 仓库` }
    }
    const info = chosen === 'svn'
      ? await svnWorkingCopyInfo(collected.cwd, signal)
      : await gitRepoInfo(collected.cwd, signal)
    return { ok: true, kind: chosen, info }
  }

  /**
   * Files that differ between the working copy and the repository's base state.
   *
   * This is the repository's whole view, which is wider than one session's work:
   * the panel deliberately lists the session's files instead, and uses this only
   * to describe the repository.
   */
  const vcsChangedFiles = async (sessionId, kind, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    if (collected.cwd === undefined) return { ok: false, code: 'no-cwd', error: '会话没有工作目录' }
    const detected = await detectVcs(sessionId, collected.cwd, signal)
    if (detected.kind === null) {
      return { ok: false, code: 'no-vcs', error: detected.reason ?? '当前工作目录不是版本控制仓库' }
    }
    const chosen = kind ?? detected.kind
    if (chosen !== detected.kind) {
      return { ok: false, code: 'no-vcs', error: `当前工作目录是 ${detected.kind.toUpperCase()} 仓库` }
    }

    if (chosen === 'git') {
      // `git status` finds every touched path (including untracked); `--numstat`
      // supplies the added/deleted counts the list shows.
      const status = await runCommand(
        collected.cwd,
        ['git', 'status', '--porcelain=v1', '--no-renames', '--untracked-files=all'],
        signal,
      )
      if (!status.ok) return { ok: false, code: 'git-failed', error: status.error }
      const stat = await runCommand(collected.cwd, ['git', 'diff', 'HEAD', '--numstat', '--no-renames'], signal)
      const counts = new Map()
      if (stat.ok) {
        for (const line of stat.stdout.split(/\r?\n/)) {
          const parts = line.split('\t')
          if (parts.length < 3) continue
          const added = parts[0] === '-' ? 0 : Number(parts[0])
          const deleted = parts[1] === '-' ? 0 : Number(parts[1])
          counts.set(parts[2], { added, deleted })
        }
      }
      const files = []
      for (const raw of status.stdout.split(/\r?\n/)) {
        if (raw.trim() === '') continue
        const code = raw.slice(0, 2).trim()
        const path = raw.slice(3).trim()
        if (path === '') continue
        const known = counts.get(path)
        let added = known?.added
        let deleted = known?.deleted
        if (code === '??') {
          // An untracked file has no HEAD side: every line is new.
          try {
            const text = await readTextAt(absoluteOf(collected.cwd, { path }), signal)
            added = splitLines(text).lines.length
            deleted = 0
          } catch {
            added = 0
            deleted = 0
          }
        }
        files.push({ path, display: path, status: code, added, deleted, untracked: code === '??' })
      }
      return { ok: true, kind, base: 'HEAD', files, info: await gitRepoInfo(collected.cwd, signal) }
    }

    const status = await runCommand(collected.cwd, ['svn', 'status', '--non-interactive'], signal)
    // `svn status` exits 0 even when the directory is not a working copy: it only
    // writes a warning to stderr. Treating that as "no changes" is how the panel
    // used to claim 暂无改动 on a checkout that plainly had modifications.
    if (!status.ok) return { ok: false, code: 'svn-failed', error: status.error }
    const dialogue = `${status.stdout}\n${status.stderr}`
    if (/svn: (warning|E\d+)/i.test(dialogue)) {
      const line = dialogue.split('\n').map((item) => item.trim()).find((item) => item.startsWith('svn:')) ?? ''
      return { ok: false, code: 'svn-failed', error: line.replace(/^svn:\s*(warning:\s*)?/, '') }
    }
    // Naming the working copy it actually measured turns an empty list from a
    // dead end into something the reader can check.
    const info = await svnWorkingCopyInfo(collected.cwd, signal)
    const files = []
    for (const raw of status.stdout.split(/\r?\n/)) {
      if (raw.trim() === '') continue
      // Seven status columns, then whitespace, then the path. Parsing by pattern
      // keeps absolute paths working (svn prints those when it resolves another
      // working copy's root).
      const match = /^(.{1,7})\s+(.+?)\r?$/.exec(raw)
      if (match === null) continue
      const code = match[1].trim()
      const path = match[2].trim().replace(/\\/g, '/')
      if (path === '' || code === '') continue
      files.push({ path, display: path, status: code.slice(0, 1), untracked: code.startsWith('?') })
    }
    return { ok: true, kind, base: 'BASE', files, info }
  }

  /** One file compared against the repository base, as reviewable hunks. */
  const vcsFileDiff = async (sessionId, kind, path, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    if (collected.cwd === undefined) return { ok: false, code: 'no-cwd', error: '会话没有工作目录' }
    const detected = await detectVcs(sessionId, collected.cwd, signal)
    if (detected.kind === null) {
      return { ok: false, code: 'no-vcs', error: detected.reason ?? '当前工作目录不是版本控制仓库' }
    }
    const chosen = kind ?? detected.kind
    if (chosen !== detected.kind) {
      return { ok: false, code: 'no-vcs', error: `当前工作目录是 ${detected.kind.toUpperCase()} 仓库` }
    }
    const display = path
    if (chosen === 'git') {
      // An untracked file has no base to diff against, so it reads as one
      // whole-file addition.
      const check = await runCommand(
        collected.cwd,
        ['git', 'status', '--porcelain=v1', '--no-renames', '--', path],
        signal,
      )
      const untracked = check.ok && check.stdout.split('\n').some((line) => line.startsWith('??'))
      if (untracked) {
        try {
          const text = await readTextAt(absoluteOf(collected.cwd, { path }), signal)
          const split = splitLines(text)
          const lines = split.lines.map((line) => `+${line}`)
          return {
            ok: true,
            kind,
            base: 'HEAD',
            path,
            display,
            diffKind: 'text',
            untracked: true,
            hunks: lines.length === 0 ? [] : [{
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: lines.length,
              lines,
            }],
          }
        } catch (error) {
          return { ok: false, code: 'read-failed', error: `读取失败：${messageOf(error)}` }
        }
      }
      const run = await runCommand(collected.cwd, ['git', 'diff', 'HEAD', '--unified=3', '--no-renames', '--', path], signal)
      if (!run.ok) return { ok: false, code: 'git-failed', error: run.error }
      return {
        ok: true,
        kind,
        base: 'HEAD',
        path,
        display,
        diffKind: 'text',
        untracked: false,
        hunks: parseUnifiedDiff(run.stdout),
      }
    }
    const run = await runCommand(collected.cwd, ['svn', 'diff', '--non-interactive', path], signal)
    if (!run.ok) return { ok: false, code: 'svn-failed', error: run.error }
    const text = run.stdout
    const stderrLine = run.stderr.split(/\r?\n/).map((item) => item.trim()).find((item) => item.startsWith('svn:')) ?? ''
    if (stderrLine !== '' && /svn: (warning|E\d+)/i.test(stderrLine)) {
      // A working copy can legitimately not track this path (a file the session
      // created, or one excluded by ignore rules). That is a state, not a fault.
      const one = await runCommand(collected.cwd, ['svn', 'status', '--non-interactive', '--', path], signal)
      const listed = one.ok ? one.stdout.trim().split(/\r?\n/)[0] ?? '' : ''
      if (listed.startsWith('?') || listed === '') {
        try {
          const current = await readTextAt(absoluteOf(collected.cwd, { path }), signal)
          const split = splitLines(current)
          const lines = split.lines.map((line) => `+${line}`)
          return {
            ok: true,
            kind,
            base: 'BASE',
            path,
            display,
            diffKind: 'text',
            untracked: true,
            hunks: lines.length === 0 ? [] : [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines }],
          }
        } catch {
          return { ok: false, code: 'svn-untracked', error: '该文件不在版本控制中' }
        }
      }
      return { ok: false, code: 'svn-failed', error: stderrLine.replace(/^svn:\s*(warning:\s*)?/, '') }
    }
    if (text.includes('Cannot display:') || text.includes('(binary)')) {
      return { ok: true, kind, base: 'BASE', path, display, diffKind: 'binary', untracked: false, hunks: [] }
    }
    return {
      ok: true,
      kind,
      base: 'BASE',
      path,
      display,
      diffKind: 'text',
      untracked: false,
      hunks: parseUnifiedDiff(text),
    }
  }

  const rollback = async (sessionId, kind, ref, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    if (collected.cwd === undefined) return { ok: false, code: 'no-cwd', error: '会话没有工作目录' }
    if (typeof ref !== 'string' || ref.trim() === '') {
      return { ok: false, code: 'no-ref', error: '请选择一个版本点' }
    }
    const argv = kind === 'svn'
      ? ['svn', 'update', '-r', ref, '--non-interactive']
      : ['git', 'reset', '--hard', ref]
    const run = await runCommand(collected.cwd, argv, signal)
    if (!run.ok) {
      return { ok: false, code: kind === 'svn' ? 'svn-failed' : 'git-failed', error: run.error }
    }
    clearSession(sessionId)
    return { ok: true, kind, ref, output: run.stdout.trim() }
  }

  // ------------------------------------------------------------------- payloads

  /**
   * The review queue for one Session.
   *
   * `batches` is every recorded summary, oldest first, each with its own files
   * and decision state. `front` is the batch the bar shows — the earliest one
   * that still has unconfirmed files — so working through the queue never hides
   * an earlier change behind a later one.
   */
  const buildState = async (sessionId, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) {
      return {
        ok: false,
        code: collected.code,
        error: collected.error,
        batches: [],
        queue: [],
        front: null,
        files: [],
        pending: 0,
        totals: { batches: 0, pendingBatches: 0, files: 0, pending: 0, added: 0, deleted: 0 },
      }
    }
    const detected = await detectVcs(sessionId, collected.cwd, signal)
    return {
      ok: true,
      cwd: collected.cwd,
      turn: collected.turn,
      vcs: detected,
      restored: collected.restored === true,
      batches: collected.batches,
      queue: collected.queue,
      front: collected.front ?? null,
      files: collected.files,
      pending: collected.totals.pending,
      totals: collected.totals,
      nativeCard: nativeCard.status(),
    }
  }

  /**
   * One file's comparison as a single continuous diff, plus an annotation per
   * hunk naming the round that first introduced it.
   *
   * Each recording compares the turn baseline to the state at that moment, so
   * the newest one already contains every earlier change and its line numbers are
   * the true final ones. Earlier recordings are consulted only to decide which
   * round a hunk came from — never to build positions.
   */
  const buildDiff = async (sessionId, path, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    const merged = collected.files.find((candidate) => candidate.path === path)
    if (merged === undefined) return { ok: false, code: 'no-file', error: '该文件已不在改动列表中' }

    const latestSeq = merged.parts[merged.parts.length - 1]?.seq
    const found = await diffOf(sessionId, latestSeq, path, signal)
    if (!found.ok) return { ok: false, code: found.code, error: found.error }
    const { batch, file, diff } = found
    const record = decisionOf(sessionId, batch.seq, file.path)
    const states = record?.hunks ?? {}

    const base = {
      ok: true,
      path: merged.path,
      display: merged.display,
      seq: batch.seq,
      turn: batch.turn,
      rounds: merged.parts.length,
      handled: merged.handled === true,
      restored: found.restored === true,
      states,
      kind: diff.kind,
    }
    if (diff.kind !== 'text') {
      return { ...base, hunks: [], cursor: undefined, progress: { decided: 0, total: 0 } }
    }

    // Which recording first introduced each hunk.
    //
    // An exact signature match is too strict: the newest recording's hunk usually
    // also contains the lines earlier recordings added (every recording re-diffs
    // from the turn baseline), so it would never match and every hunk would be
    // credited to the newest turn. Instead a hunk is attributed to the OLDEST
    // recording whose added lines are all present in it — that is the change this
    // block traces back to.
    const addedOf = (hunk) => (hunk.lines ?? [])
      .filter((line) => line[0] === '+')
      .map((line) => line.slice(1))

    const earlierParts = []
    if (merged.parts.length > 1) {
      for (let index = 0; index < merged.parts.length - 1; index += 1) {
        const part = merged.parts[index]
        const earlier = await diffOf(sessionId, part.seq, path, signal)
        if (!earlier.ok || earlier.diff.kind !== 'text') continue
        earlierParts.push({ round: index + 1, turn: part.turn, hunks: earlier.diff.hunks })
      }
    }

    const latestPart = merged.parts[merged.parts.length - 1]
    const latestOrigin = { round: merged.parts.length, turn: latestPart?.turn ?? batch.turn }

    const originOf = (hunk) => {
      const added = addedOf(hunk)
      if (added.length === 0) {
        // A pure deletion traces back by its removed lines.
        const removed = (hunk.lines ?? []).filter((line) => line[0] === '-').map((line) => line.slice(1))
        for (const part of earlierParts) {
          for (const earlier of part.hunks) {
            const earlierRemoved = (earlier.lines ?? []).filter((line) => line[0] === '-').map((line) => line.slice(1))
            if (earlierRemoved.length > 0 && earlierRemoved.every((line) => removed.includes(line))) {
              return { round: part.round, turn: part.turn }
            }
          }
        }
        return latestOrigin
      }
      const present = new Set(added)
      for (const part of earlierParts) {
        for (const earlier of part.hunks) {
          const earlierAdded = addedOf(earlier)
          if (earlierAdded.length > 0 && earlierAdded.every((line) => present.has(line))) {
            return { round: part.round, turn: part.turn }
          }
        }
      }
      return latestOrigin
    }

    const hunks = diff.hunks.map((hunk, index) => {
      const origin = originOf(hunk)
      return {
        idx: index,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines,
        // Which change this hunk belongs to: its ordinal among the recordings
        // that touched this file, and the conversation turn it came from.
        round: origin.round,
        originTurn: origin.turn,
      }
    })

    // "Handled" settles every hunk at once: keeping a whole file records a
    // file-level decision rather than per-hunk ones, so the panel must not still
    // report an undecided first hunk and keep offering accept/reject.
    const settled = record?.done === true
    const cursor = settled ? undefined : hunks.find((hunk) => states[hunk.idx] === undefined)
    return {
      ...base,
      coarse: diff.coarse === true,
      before: diff.before,
      after: diff.after,
      hunks,
      cursor: cursor === undefined ? undefined : { seq: batch.seq, hunkIdx: cursor.idx },
      progress: settled
        ? { decided: hunks.length, total: hunks.length }
        : { decided: Object.keys(states).length, total: hunks.length },
    }
  }

  /**
   * The current text of one changed file, for the panel's unchanged-region
   * folding. Bounded so a huge file cannot stall the page.
   */
  const buildFileText = async (sessionId, path, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    const merged = collected.files.find((candidate) => candidate.path === path)
    if (merged === undefined) return { ok: false, code: 'no-file', error: '该文件已不在改动列表中' }
    if (merged.binary === true || merged.oversized === true) {
      return { ok: false, code: 'unsupported', error: merged.binary === true ? '二进制文件没有文本内容' : '文件过大，不展开' }
    }
    if (collected.cwd === undefined) return { ok: false, code: 'no-cwd', error: '会话没有工作目录' }
    try {
      const text = await readTextAt(absoluteOf(collected.cwd, { path: merged.path }), signal)
      if (text.length > MAX_FILE_TEXT_BYTES) {
        return { ok: false, code: 'too-large', error: '文件过大，不展开未改动部分' }
      }
      return { ok: true, path: merged.path, text, lines: text.split('\n').length }
    } catch (error) {
      return { ok: false, code: 'read-failed', error: `读取失败：${messageOf(error)}` }
    }
  }

  /** Every hunk decided means the file no longer needs review. */
  const settle = (record, hunks) => {
    if (record.done) return true
    const total = Array.isArray(hunks) ? hunks.length : 0
    if (total === 0) {
      record.done = true
      return true
    }
    const decided = Object.keys(record.hunks).length
    if (decided >= total) {
      record.done = true
      return true
    }
    return false
  }

  // --------------------------------------------------------------- action verbs

  const acceptHunk = async (sessionId, seq, path, hunkIdx, signal) => {
    const found = await diffOf(sessionId, seq, path, signal)
    if (!found.ok) return { ok: false, code: found.code, error: found.error }
    const { batch, file, diff } = found
    if (diff.kind === 'text' && Number.isInteger(hunkIdx) && diff.hunks[hunkIdx] === undefined) {
      return { ok: false, code: 'no-hunk', error: '该改动块不存在' }
    }
    const record = freshDecision(sessionId, batch.seq, file.path)
    record.hunks[hunkIdx] = 'accept'
    settle(record, diff.kind === 'text' ? diff.hunks : [])
    persistDecision(sessionId, record)
    return { ok: true }
  }

  const rejectHunk = async (sessionId, seq, path, hunkIdx, signal) => {
    const found = await diffOf(sessionId, seq, path, signal)
    if (!found.ok) return { ok: false, code: found.code, error: found.error }
    const { collected, batch, file, diff } = found
    if (diff.kind !== 'text') {
      return { ok: false, code: 'unsupported', error: diff.kind === 'binary' ? '二进制文件无法撤销' : '文件过大，无法撤销' }
    }
    const hunk = diff.hunks[hunkIdx]
    if (hunk === undefined) return { ok: false, code: 'no-hunk', error: '该改动块不存在' }
    if (collected.cwd === undefined) return { ok: false, code: 'no-cwd', error: '会话没有工作目录' }

    const record = freshDecision(sessionId, batch.seq, file.path)
    const applied = Object.entries(record.hunks)
      .filter(([, state]) => state === 'reject')
      .map(([index]) => Number(index))
    const shift = shiftFor(diff.hunks, applied, hunkIdx)

    const absolute = absoluteOf(collected.cwd, file)
    let split
    try {
      split = splitLines(await readTextAt(absolute, signal))
    } catch (error) {
      return { ok: false, code: 'read-failed', error: `读取失败：${messageOf(error)}` }
    }
    const result = reverseOne(split.lines, hunk, shift)
    if (!result.ok) {
      return { ok: false, code: 'conflict', error: '文件已漂移：当前内容与该改动块不一致，未写入' }
    }
    try {
      await writeTextAt(absolute, renderText(result.lines, split.trailingNewline), signal, sessionId)
    } catch (error) {
      return { ok: false, code: 'write-failed', error: `写入失败：${messageOf(error)}` }
    }
    record.hunks[hunkIdx] = 'reject'
    settle(record, diff.hunks)
    persistDecision(sessionId, record)
    return { ok: true }
  }

  /**
   * Keep a whole file: the newest recording already contains every earlier
   * change, so confirming it settles the file's review unit.
   */
  const acceptFile = async (sessionId, seq, path, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    const merged = collected.files.find((candidate) => candidate.path === path)
    if (merged === undefined) return { ok: false, code: 'no-file', error: '该文件已不在改动列表中' }
    const latestSeq = Number.isInteger(seq) ? seq : merged.parts[merged.parts.length - 1]?.seq
    if (!Number.isInteger(latestSeq)) return { ok: false, code: 'no-file', error: '该文件已不在改动列表中' }
    const record = freshDecision(sessionId, latestSeq, merged.path)
    record.done = true
    record.file = 'accept'
    persistDecision(sessionId, record)
    return { ok: true }
  }

  /**
   * Undo a whole file: walk its batches newest first.
   *
   * Only that order can work — a newer batch's hunks were recorded against the
   * content the older batch produced, so unwinding from the oldest would fail
   * immediately with a false conflict.
   */
  const revertFile = async (sessionId, seq, path, signal) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    const merged = collected.files.find((candidate) => candidate.path === path)
    if (merged === undefined) return { ok: false, code: 'no-file', error: '该文件已不在改动列表中' }
    if (collected.cwd === undefined) return { ok: false, code: 'no-cwd', error: '会话没有工作目录' }

    // Undo every round that touched the file, newest first: that is the only
    // order whose line numbers match the content being unwound. Rounds already
    // confirmed are included — "撤销这个文件" means back to before all of them.
    const parts = [...merged.parts].reverse()
    let reverted = 0
    for (const part of parts) {
      const batch = collected.batches.find((candidate) => candidate.seq === part.seq)
      const file = batch?.files.find((candidate) => candidate.path === merged.path)
      if (batch === undefined || file === undefined) continue
      const result = await revertWholeFile(sessionId, batch, file, collected.cwd, signal)
      if (!result.ok) {
        return { ...result, reverted, of: parts.length }
      }
      reverted += 1
    }
    return { ok: true, path: merged.path, reverted, of: parts.length }
  }

  /**
   * Apply one file-level operation to every pending file.
   *
   * The bar reviews a merged file list, so its bulk actions cover exactly the
   * files it shows — each of them spanning every batch that touched it.
   */
  const forEveryPendingFile = async (sessionId, operation, signal, skipUnrevertible = false) => {
    const collected = await collect(sessionId)
    if (!collected.ok) return { ok: false, code: collected.code, error: collected.error }
    const targets = collected.files.filter((file) => !file.handled)
    if (collected.cwd === undefined && targets.length > 0) {
      return { ok: false, code: 'no-cwd', error: '会话没有工作目录' }
    }
    const failures = []
    const skipped = []
    let handled = 0
    for (const file of targets) {
      // A binary or oversized file has no revertible lines; a bulk revert
      // reports it separately instead of failing the whole run. Accepting one
      // is only a marker, so it stays in the run.
      if (skipUnrevertible && (file.binary === true || file.oversized === true)) {
        skipped.push(file.display)
        continue
      }
      const result = await operation(file, collected.cwd, signal)
      if (result.ok) handled += 1
      else failures.push(`${file.display}：${result.error ?? result.code}`)
    }
    return { ok: failures.length === 0, handled, failures, skipped, total: targets.length }
  }

  // ------------------------------------------------------------------ transport

  const handleGet = async (request) => {
    let url
    try {
      url = new URL(request.url)
    } catch {
      return json({ ok: false, error: '无效的请求地址' }, 400)
    }
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const signal = request.signal

    // Diagnostics do not belong to a Session, and deliberately expose nothing
    // but this plugin's own log: these routes carry no caller identity, so
    // anything they return is readable by any local process.
    if (url.pathname === `${NS}/log`) return json({ ok: true, lines: debugLines.slice(-50) })

    if (sessionId === '') return json({ ok: false, error: '缺少 sessionId' }, 400)

    try {
      switch (url.pathname) {
        case `${NS}/state`:
          return json(await buildState(sessionId, signal))
        case `${NS}/diff`: {
          const path = url.searchParams.get('path') ?? ''
          if (path === '') return json({ ok: false, error: '缺少 path' }, 400)
          return json(await buildDiff(sessionId, path, signal))
        }
        case `${NS}/file`: {
          const path = url.searchParams.get('path') ?? ''
          if (path === '') return json({ ok: false, error: '缺少 path' }, 400)
          return json(await buildFileText(sessionId, path, signal))
        }
        case `${NS}/refs`: {
          const kind = url.searchParams.get('kind') ?? undefined
          return json(await listRefs(sessionId, kind, signal))
        }
        case `${NS}/vcs-info`: {
          const kind = url.searchParams.get('kind') ?? undefined
          return json(await vcsRepoInfo(sessionId, kind, signal))
        }
        case `${NS}/vcs-state`: {
          const kind = url.searchParams.get('kind') ?? undefined
          return json(await vcsChangedFiles(sessionId, kind, signal))
        }
        case `${NS}/vcs-diff`: {
          const path = url.searchParams.get('path') ?? ''
          const kind = url.searchParams.get('kind') ?? undefined
          if (path === '') return json({ ok: false, error: '缺少 path' }, 400)
          return json(await vcsFileDiff(sessionId, kind, path, signal))
        }
        case `${NS}/ref-files`: {
          const kind = url.searchParams.get('kind') ?? 'git'
          const ref = url.searchParams.get('ref') ?? ''
          return json(await refFiles(sessionId, kind, ref, signal))
        }
        default:
          return json({ ok: false, error: `未知接口 ${url.pathname}` }, 404)
      }
    } catch (error) {
      log(`GET ${url.pathname} failed: ${messageOf(error)}`)
      return json({ ok: false, error: messageOf(error) }, 500)
    }
  }

  const readJsonBody = async (request) => {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text === '') return {}
    return JSON.parse(text)
  }

  const handleAct = async (request) => {
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      return json({ ok: false, error: `无法解析请求体：${messageOf(error)}` }, 400)
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    // Browser diagnostics carry no Session: they report page-level state.
    if (body.op === 'debug') {
      log(`browser: ${String(body.message ?? '')}`)
      return json({ ok: true })
    }
    if (sessionId === '') return json({ ok: false, error: '缺少 sessionId' }, 400)
    const path = typeof body.path === 'string' ? body.path : ''
    // Bulk actions name a batch; a missing seq means the queue's front batch.
    const seq = Number.isInteger(body.seq) ? body.seq : undefined
    const signal = request.signal

    try {
      switch (body.op) {
        case 'acceptHunk':
          return json(await acceptHunk(sessionId, seq, path, body.hunkIdx, signal))
        case 'rejectHunk':
          return json(await rejectHunk(sessionId, seq, path, body.hunkIdx, signal))
        case 'acceptFile':
          return json(await acceptFile(sessionId, seq, path, signal))
        case 'revertFile':
          return json(await revertFile(sessionId, seq, path, signal))
        case 'acceptAll':
          return json(await forEveryPendingFile(
            sessionId,
            async (file) => acceptFile(sessionId, undefined, file.path, signal),
            signal,
          ))
        case 'rejectAll':
          return json(await forEveryPendingFile(
            sessionId,
            async (file, cwd) => revertFile(sessionId, undefined, file.path, signal),
            signal,
            true,
          ))
        case 'rollback':
          return json(await rollback(sessionId, body.kind === 'svn' ? 'svn' : 'git', body.ref, signal))
        default:
          return json({ ok: false, error: `未知操作 ${String(body.op)}` }, 400)
      }
    } catch (error) {
      log(`ACT ${String(body.op)} failed: ${messageOf(error)}`)
      return json({ ok: false, error: messageOf(error) }, 500)
    }
  }

  // ------------------------------------------------------------------ lifecycle

  const nativeCard = createNativeCardController(ctx, readHideNative)

  // Decisions a previous Host process made, so "已保留" does not come back as
  // pending after a restart.
  restoreDecisions()

  ctx.effect(() => {
    // Write whatever is still pending when this plugin unloads or the Host stops.
    return () => {
      flushStore()
    }
  }, 'dsh-changes: persisted state')

  ctx.effect(() => {
    void nativeCard.apply().catch((error) => log(`native card toggle failed: ${messageOf(error)}`))
    // The flag lives in memory only (that is what keeps uninstall residue-free),
    // so the composition can overwrite it later — most visibly on a fresh start,
    // where this activation races the loader composing that row. Re-assert when
    // the live entry disagrees with the desired state, with a cap so a host that
    // refuses the change is not fought forever.
    let attempts = 0
    const timer = setInterval(() => {
      if (attempts >= 20) return
      const status = nativeCard.status()
      if (status.available !== true) return
      const desired = readHideNative()
      const actual = status.entryDisabled === true
      if (desired === actual) return
      attempts += 1
      void nativeCard.apply().catch((error) => log(`native card re-assert failed: ${messageOf(error)}`))
    }, 1500)
    if (typeof timer.unref === 'function') timer.unref()
    return () => {
      clearInterval(timer)
      void nativeCard.dispose().catch(() => {})
    }
  }, 'dsh-changes: native changes card')

  // A volatile edit commits into the running fiber without a restart, so the
  // toggle follows the document instead of waiting for a reload.
  ctx.on('settings/document-updated', (ns) => {
    if (String(ns) !== 'dsh-changes') return
    void nativeCard.apply().catch((error) => log(`native card re-apply failed: ${messageOf(error)}`))
  })

  ctx.effect(() => {
    const server = ctx.get('webServer')
    if (server === undefined) return () => {}
    const offState = server.register({ kind: 'prefix', path: NS, resource: handleGet })
    const offAct = server.register({
      kind: 'exact',
      path: `${NS}/act`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', ...JSON_HEADERS })
          res.end(JSON.stringify({ ok: false, error: '仅支持 POST' }))
          return
        }
        const response = await handleAct(req)
        res.writeHead(response.status, JSON_HEADERS)
        res.end(await response.text())
      },
    })
    return () => {
      offState()
      offAct()
    }
  }, 'dsh-changes: web routes')
}
