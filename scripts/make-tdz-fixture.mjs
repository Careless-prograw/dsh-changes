import fs from 'node:fs'

// Builds a copy of client.js with the showHandled declaration moved back below
// its first use, recreating the TDZ bug, so the render test can be proven to
// catch it.
const source = fs.readFileSync('client.js', 'utf8')
const declaration = '      const [showHandled, setShowHandled] = useState(false)\n'
if (!source.includes(declaration)) throw new Error('declaration anchor not found')

let broken = source.replace(declaration, '')
const anchor = '      const [expanded, setExpanded] = useState({})\n'
if (!broken.includes(anchor)) throw new Error('insert anchor not found')
broken = broken.replace(anchor, declaration + anchor)

fs.writeFileSync('client.tdz.js', broken, 'utf8')
console.log('wrote client.tdz.js (showHandled moved after its first use)')
