/**
 * Renders the plugin's components with a minimal React stand-in.
 *
 * HTTP tests exercise the Host half only, so a broken client render (a temporal
 * dead zone reference, an undeclared identifier) would ship silently. This runs
 * the real factory from client.js, calls `apply(ctx)` against a stub Cordis
 * context, then *actually renders* every element tree it registered — walking
 * into nested function components, because a TDZ bug inside a child component is
 * invisible when only the wrapper element gets built.
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
globalThis.window.__ModuleLoader__ = { load: (entry) => { factory = entry.factory } }
const requireShim = (id) => {
  if (id === 'react') return react
  throw new Error(`unexpected require('${id}')`)
}

new Function('require', 'window', 'globalThis', source)(requireShim, globalThis, globalThis)
if (typeof factory !== 'function') throw new Error('loader did not receive a factory')
const plugin = factory(requireShim)
if (plugin === undefined || typeof plugin.apply !== 'function') {
  throw new Error('factory did not return a plugin object with apply()')
}

// --- render the tree ---------------------------------------------------------
const MAX_DEPTH = 60

const renderNode = (node, depth) => {
  if (node === null || node === undefined || typeof node !== 'object') return 1
  if (depth > MAX_DEPTH) throw new Error('render tree too deep (probable cycle)')
  let count = 0
  const { type, props } = node
  if (typeof type === 'function') {
    // A function component: execute it, then walk what it returned. Class
    // components (the error boundary) are skipped — their render needs a real
    // React reconciler.
    const isClass = /^class\s/.test(Function.prototype.toString.call(type))
    if (!isClass) {
      cursor = 0
      count += 1
      count += renderNode(type(props ?? {}), depth + 1)
    }
  }
  const children = props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    count += renderNode(child, depth + 1)
  }
  return count
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

let failures = 0
let totalComponents = 0
for (const [key, render] of slots) {
  cursor = 0
  state.length = 0
  try {
    const components = renderNode(render({ sessionId: 'probe-session' }), 0)
    totalComponents += components
    console.log(`  ${key} -> rendered ${components} component(s)`)
  } catch (error) {
    failures += 1
    console.log(`  ${key} -> THREW: ${error.message}`)
  }
}

if (slots.size === 0) throw new Error('the plugin registered no slot renderer')
if (totalComponents === 0) throw new Error('no component was actually executed')
if (failures > 0) throw new Error(`${failures} slot(s) threw while rendering`)
console.log(`OK: rendered ${totalComponents} component(s) across ${slots.size} slot(s) without throwing`)
