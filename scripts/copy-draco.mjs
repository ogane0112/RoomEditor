// Copies three.js' DRACO decoder into public/ so compressed GLBs can be
// decoded fully offline (no CDN request, scan data never leaves the browser).
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/three/examples/jsm/libs/draco/gltf')
const dest = resolve(root, 'public/draco')
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
