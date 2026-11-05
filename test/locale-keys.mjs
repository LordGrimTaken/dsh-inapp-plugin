import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const clientPath = fileURLToPath(new URL('../client.js', import.meta.url))
const src = readFileSync(clientPath, 'utf8')
const used = new Set()
for (const match of src.matchAll(/tr\('([^']+)'/g)) used.add(match[1])
for (const match of src.matchAll(/tr\("([^"]+)"/g)) used.add(match[1])
const start = src.indexOf('const EN = {')
const end = src.indexOf('\n    };', start)
const block = src.slice(start, end)
const keys = new Set()
for (const match of block.matchAll(/'([^']+)'\s*:/g)) keys.add(match[1])
const missing = [...used].filter((key) => !keys.has(key))
const unused = [...keys].filter((key) => !used.has(key))
console.log(JSON.stringify({ used: used.size, defined: keys.size, missing, unused }, null, 2))
