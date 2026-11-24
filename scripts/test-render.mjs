/**
 * Renders the plugin's components with a minimal React stand-in.
 *
 * HTTP tests exercise the Host half only, so a broken client render (a temporal
 * dead zone reference, an undeclared identifier) would ship silently. This runs
 * the real factory from client.js, calls `apply(ctx)` against a stub Cordis
 * context, then invokes every slot renderer it registered.
 */
import fs from 'node:fs'

const source = fs.readFileSync('client.js', 'utf8')

// --- minimal React -----------------------------------------------------------
let cursor = 0
const state = []
const react = {
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  }),
  Fragment: 'Fragment',
  useState: (initial) => {
    const index = cursor++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  },
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useEffect: () => undefined,
  useRef: () => ({ current: null }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  // The client declares an error boundary as a class component.
  Component: class {
    constructor(props) { this.props = props }
    setState() {}
    render() { return null }
  },
}

// --- module loader shim ------------------------------------------------------
let factory
globalThis.window = globalThis
globalThis.window.__ModuleLoader__ = {
  load: (entry) => { factory = entry.factory },
}
const requireShim = (id) => {
  if (id === 'react') return react
  throw new Error(`unexpected require('${id}')`)
}

// Execute client.js so the loader receives the factory, then run that factory.
new Function('require', 'window', 'globalThis', source)(requireShim, globalThis, globalThis)
if (typeof factory !== 'function') throw new Error('loader did not receive a factory')

const plugin = factory(requireShim)
if (plugin === undefined || typeof plugin.apply !== 'function') {
  throw new Error('factory did not return a plugin object with apply()')
}

// --- stub Cordis context -----------------------------------------------------
const slots = new Map()
const stubCtx = {
  locale: {
    register: () => undefined,
    bind: () => (key) => key,
    subscribe: () => () => undefined,
  },
  slots: {
    // `inject` gates a registration on a slot existing; the stub reports that it
    // does, so the registration runs.
    inject: (_name, run) => run(),
    register: (spec, render) => {
      const key = `${spec.name}${spec.key === undefined ? '' : `#${spec.key}`}`
      slots.set(key, render)
      return () => slots.delete(key)
    },
  },
  effect: (fn) => { fn(); return () => undefined },
  get: () => undefined,
  sidebarRightTabs: { register: () => () => undefined },
  sidebarRight: { register: () => () => undefined },
}

plugin.apply(stubCtx)
console.log(`slot renderers registered: ${slots.size}`)
for (const key of slots.keys()) console.log(`  ${key}`)

// --- invoke each renderer ----------------------------------------------------
let failures = 0
for (const [key, render] of slots) {
  cursor = 0
  state.length = 0
  try {
    const element = render({ sessionId: 'probe-session' })
    console.log(`  render ${key} -> ${element === null || element === undefined ? 'null' : 'ok'}`)
  } catch (error) {
    failures += 1
    console.log(`  render ${key} -> THREW: ${error.message}`)
  }
}

if (slots.size === 0) throw new Error('the plugin registered no slot renderer')
if (failures > 0) throw new Error(`${failures} renderer(s) threw`)
console.log('OK: every slot renderer runs without throwing')
