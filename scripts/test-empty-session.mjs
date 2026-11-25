/**
 * Regression guard for the empty-Session shape.
 *
 * A brand-new Session has no recordings at all, and that is the first thing
 * anyone opens. `collect()` used to return a reduced object in that branch, so
 * the panel crashed with "Cannot read properties of undefined (reading
 * 'pending')" before the user had done anything.
 *
 * This calls the running plugin with a Session id that has no data, and checks
 * every endpoint answers instead of failing.
 */
const base = process.argv[2] ?? 'http://127.0.0.1:61710'
const sessionId = `empty-session-probe-${Date.now()}`

const get = async (path) => {
  const response = await fetch(`${base}/dsh-changes/${path}?sessionId=${sessionId}`)
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  return { status: response.status, body }
}

const expect200 = (label, result) => {
  const ok = result.status === 200
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} -> HTTP ${result.status} ${ok ? '' : JSON.stringify(result.body)}`)
  if (!ok) throw new Error(`${label} returned HTTP ${result.status}`)
  return result.body
}

console.log(`probing an empty Session: ${sessionId}`)

const state = expect200('state', await get('state'))
if (state.ok !== true) throw new Error(`state should succeed on an empty Session: ${JSON.stringify(state)}`)
for (const field of ['batches', 'queue', 'files']) {
  if (!Array.isArray(state[field])) throw new Error(`state.${field} must be an array, got ${typeof state[field]}`)
}
if (typeof state.pending !== 'number') throw new Error('state.pending must be a number')
if (typeof state.totals !== 'object' || state.totals === null) throw new Error('state.totals must be an object')
if (typeof state.totals.pending !== 'number') throw new Error('state.totals.pending must be a number')
console.log(`  state: files=${state.files.length} pending=${state.pending} totals.pending=${state.totals.pending}`)

const checkpoints = expect200('checkpoints', await get('checkpoints'))
if (checkpoints.ok !== true || !Array.isArray(checkpoints.checkpoints)) {
  throw new Error('checkpoints must return a list')
}

// These may legitimately report "no data yet", but they must answer, not 500.
for (const path of ['refs', 'vcs-info']) {
  const body = expect200(path, await get(path))
  console.log(`  ${path}: ok=${body.ok}${body.code === undefined ? '' : ` code=${body.code}`}`)
}

const diff = await fetch(`${base}/dsh-changes/diff?sessionId=${sessionId}&path=does-not-exist.txt`).then(async (response) => ({
  status: response.status,
  body: await response.json(),
}))
console.log(`  diff (unknown path) -> HTTP ${diff.status} code=${diff.body.code ?? '-'}`)
if (diff.status !== 200) throw new Error('diff must answer, not fail, for an unknown path')

console.log('OK: an empty Session answers every endpoint')
