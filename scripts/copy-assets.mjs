// three.js 同梱の DRACO デコーダを public/ にコピーし、圧縮GLBを外部CDNなしで読めるようにする
// (スキャンデータはブラウザの外に出さない)。
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/three/examples/jsm/libs/draco/gltf')
const dest = resolve(root, 'public/draco')
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
