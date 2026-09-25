import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { DepthMap } from '../lib/depth'

export interface PhotoMeshOptions {
  /** 35mm換算の焦点距離(mm)。画像の長辺の画角の計算に使う */
  focalLength35mm: number
  /** 最も手前・最も奥とみなす距離(m)。推定される奥行きは相対値のため、この範囲に当てはめる */
  near: number
  far: number
  /** 横方向の格子数(細かいほど精密だが重い) */
  columns?: number
  /** パーツ分割の細かさ(0=控えめ〜1=細かく)。奥行きの段差をどこまで小さくても輪郭とみなすかを決める */
  sensitivity?: number
  /** これより小さい破片は捨てる(格子セル数) */
  minPartCells?: number
  /** 個別パーツとして分ける最大数(残りは「その他」にまとめる) */
  maxParts?: number
}

const DEFAULTS = { columns: 256, sensitivity: 0.5, minPartCells: 40, maxParts: 24 }

/** 分割の細かさ(0〜1)を、輪郭とみなす視差の段差に変換する(実際の推定結果で調整した値) */
export function edgeThresholdFor(sensitivity: number) {
  const s = Math.min(Math.max(sensitivity, 0), 1)
  return 0.055 * Math.pow(0.018 / 0.055, s)
}

/** 写真スキャンのGLBに含める、撮影時のカメラの名前 */
export const PHOTO_CAMERA_NAME = 'PhotoCamera'

/** 画像の長辺方向の画角(ラジアン) */
export function longSideFov(focalLength35mm: number) {
  return 2 * Math.atan(18 / focalLength35mm)
}

function sampleBilinear(depth: DepthMap, u: number, v: number) {
  const x = Math.min(Math.max(u * (depth.width - 1), 0), depth.width - 1)
  const y = Math.min(Math.max(v * (depth.height - 1), 0), depth.height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, depth.width - 1)
  const y1 = Math.min(y0 + 1, depth.height - 1)
  const fx = x - x0
  const fy = y - y0
  const d = depth.data
  const w = depth.width
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx
  const bottom = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx
  return top * (1 - fy) + bottom * fy
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/** mask の各画素を radius 画素ぶん太らせる */
function dilate(mask: Uint8Array, w: number, h: number, radius: number) {
  if (radius <= 0) return mask.slice()
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = -radius; dy <= radius; dy++) {
        const qy = y + dy
        if (qy < 0 || qy >= h) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const qx = x + dx
          if (qx >= 0 && qx < w) out[qy * w + qx] = 1
        }
      }
    }
  }
  return out
}

/**
 * 視差マップを、奥行きの段差(物体の輪郭)で区切られた領域に分ける。
 * 1. 視差の段差が大きい所を輪郭とする(遠くの細かな揺らぎには反応しにくいよう、距離ではなく視差で判定)
 * 2. 輪郭をさらに太らせてから領域を塗り分け、細いくびれでつながった物体同士を切り離す
 * 3. 太らせた分を領域に戻し、最後に輪郭上の点も、視差が最も近い隣の領域に含める
 * @returns 各点の領域番号
 */
export function segmentDisparity(disp: Float32Array, w: number, h: number, edge: number, erode = 2, seedSize = 12) {
  const at = (x: number, y: number) => disp[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  const rawEdge = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = Math.abs(at(x + 1, y) - at(x - 1, y))
      const gy = Math.abs(at(x, y + 1) - at(x, y - 1))
      if (Math.max(gx, gy) > edge) rawEdge[y * w + x] = 1
    }
  }
  const hard = dilate(rawEdge, w, h, 1)
  const eroded = dilate(hard, w, h, erode)

  const label = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (eroded[s] || label[s] >= 0) continue
    const id = sizes.length
    let n = 0
    label[s] = id
    stack.push(s)
    while (stack.length) {
      const p = stack.pop()!
      n++
      const px = p % w
      const py = (p - px) / w
      for (const [dx, dy] of NEIGHBORS) {
        const qx = px + dx
        const qy = py + dy
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue
        const q = qy * w + qx
        if (!eroded[q] && label[q] < 0) {
          label[q] = id
          stack.push(q)
        }
      }
    }
    sizes.push(n)
  }
  // 小さすぎる種は捨てる(周りの領域が広がって埋める)
  for (let p = 0; p < w * h; p++) if (label[p] >= 0 && sizes[label[p]] < seedSize) label[p] = -1

  // 領域を少しずつ同時に広げる。canEnter が true の点にだけ広がる
  const grow = (canEnter: (q: number, from: number) => boolean) => {
    let frontier: number[] = []
    for (let p = 0; p < w * h; p++) if (label[p] >= 0) frontier.push(p)
    while (frontier.length) {
      const next: number[] = []
      for (const p of frontier) {
        const px = p % w
        const py = (p - px) / w
        for (const [dx, dy] of NEIGHBORS) {
          const qx = px + dx
          const qy = py + dy
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue
          const q = qy * w + qx
          if (label[q] < 0 && canEnter(q, p)) {
            label[q] = label[p]
            next.push(q)
          }
        }
      }
      frontier = next
    }
  }
  grow((q) => !hard[q])
  // 輪郭上の点は、視差が近い(=同じ面にある)隣の領域から順に取り込む
  for (const limit of [edge, edge * 2, edge * 4, Infinity]) grow((q, from) => Math.abs(disp[q] - disp[from]) <= limit)
  return label
}

/**
 * 写真と奥行きマップから、写真を貼った3Dメッシュ群を作る。
 * カメラは原点から -Z 方向を向いていたとみなして各画素を3D空間へ戻し、
 * 奥行きが大きく飛ぶ所(物体の輪郭)で面を切ることで、手前の家具などを別パーツに分ける。
 */
export function buildPhotoMeshes(image: HTMLCanvasElement, depth: DepthMap, options: PhotoMeshOptions) {
  const { columns, sensitivity, minPartCells, maxParts } = { ...DEFAULTS, ...options }
  const aspect = image.width / image.height
  const cols = columns
  const rows = Math.max(2, Math.round(columns / aspect))

  // 長辺の画角から縦横それぞれの tan(画角/2) を求める
  const tanLong = Math.tan(longSideFov(options.focalLength35mm) / 2)
  const tanX = aspect >= 1 ? tanLong : tanLong * aspect
  const tanY = aspect >= 1 ? tanLong / aspect : tanLong

  // 相対的な視差(0=最奥, 1=最手前)を距離に変換する
  const invNear = 1 / options.near
  const invFar = 1 / options.far
  const vx = cols + 1
  const vy = rows + 1
  const positions = new Float32Array(vx * vy * 3)
  const uvs = new Float32Array(vx * vy * 2)
  const dist = new Float32Array(vx * vy)
  const disp = new Float32Array(vx * vy)
  for (let j = 0; j < vy; j++) {
    for (let i = 0; i < vx; i++) {
      const u = i / cols
      const v = j / rows
      const disparity = sampleBilinear(depth, u, v)
      const z = 1 / (disparity * (invNear - invFar) + invFar)
      const k = j * vx + i
      dist[k] = z
      disp[k] = disparity
      positions[k * 3] = (u * 2 - 1) * tanX * z
      positions[k * 3 + 1] = (1 - v * 2) * tanY * z
      positions[k * 3 + 2] = -z
      uvs[k * 2] = u
      uvs[k * 2 + 1] = 1 - v
    }
  }

  // 奥行きの段差で領域を分け、各セルを4隅の領域に割り当てる。
  // 境目をまたぐセルは一番奥の隅の領域(=背景側)に含め、写真の視点から見て隙間ができないようにする
  const label = segmentDisparity(disp, vx, vy, edgeThresholdFor(sensitivity))
  const groups = new Map<number, number[]>()
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * vx + i
      let farthest = a
      for (const k of [a + 1, a + vx, a + vx + 1]) if (dist[k] > dist[farthest]) farthest = k
      const l = label[farthest]
      if (l < 0) continue
      let list = groups.get(l)
      if (!list) groups.set(l, (list = []))
      list.push(j * cols + i)
    }
  }
  const parts = [...groups.values()].filter((cells) => cells.length >= minPartCells).sort((a, b) => b.length - a.length)
  if (parts.length === 0) throw new Error('写真から立体を作れませんでした。別の写真で試してください。')

  // 最大のまとまりを背景(壁・床)とし、大きい順に個別パーツにする。多すぎる分は「その他」にまとめる
  const named: { name: string; cells: number[] }[] = [{ name: '背景', cells: parts[0] }]
  const rest = parts.slice(1)
  rest.slice(0, maxParts).forEach((cells, i) => named.push({ name: `パーツ${i + 1}`, cells }))
  const others = rest.slice(maxParts).flat()
  if (others.length) named.push({ name: 'その他', cells: others })

  const texture = new THREE.CanvasTexture(image)
  texture.colorSpace = THREE.SRGBColorSpace
  // GLBに埋め込むときJPEGにしてファイルサイズを抑える
  texture.userData.mimeType = 'image/jpeg'

  const group = new THREE.Group()
  group.name = 'PhotoScan'
  for (const { name, cells } of named) group.add(buildPart(name, cells))

  // 撮影したカメラ(原点から -Z 向き)も入れておき、エディタで開いたとき写真と同じ視点から見られるようにする。
  // メッシュのIDは子の並び順で決まるため、カメラは最後に追加する
  const verticalFov = THREE.MathUtils.radToDeg(2 * Math.atan(tanY))
  const camera = new THREE.PerspectiveCamera(verticalFov, aspect, 0.05, options.far * 4)
  camera.name = PHOTO_CAMERA_NAME
  group.add(camera)

  // 最も低い点が床(y=0)に来るように全体を持ち上げる
  const box = new THREE.Box3()
  group.children.forEach((o) => (o as THREE.Mesh).isMesh && box.expandByObject(o))
  group.children.forEach((o) => (o.position.y -= box.min.y))
  return group

  function buildPart(name: string, cells: number[]) {
    // このパーツで使う頂点だけを詰め直す
    const remap = new Map<number, number>()
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    const vertex = (k: number) => {
      let n = remap.get(k)
      if (n === undefined) {
        n = remap.size
        remap.set(k, n)
        pos.push(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2])
        uv.push(uvs[k * 2], uvs[k * 2 + 1])
      }
      return n
    }
    for (const c of cells) {
      const i = c % cols
      const j = (c - i) / cols
      const a = vertex(j * vx + i)
      const b = vertex(j * vx + i + 1)
      const cc = vertex((j + 1) * vx + i)
      const d = vertex((j + 1) * vx + i + 1)
      index.push(a, cc, b, b, cc, d)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geometry.setIndex(index)
    // 移動・回転の中心がパーツの中心になるよう、形状を原点まわりに寄せてから位置を持たせる
    geometry.computeBoundingBox()
    const center = geometry.boundingBox!.getCenter(new THREE.Vector3())
    geometry.translate(-center.x, -center.y, -center.z)
    geometry.computeVertexNormals()

    // 写真自体に陰影が写っているので、ライティングの影響を受けない素材にする
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }))
    mesh.name = name
    mesh.position.copy(center)
    return mesh
  }
}

/** 写真スキャン結果をGLB(Blob)にする */
export async function exportPhotoMeshesGLB(group: THREE.Group): Promise<Blob> {
  const result = await new GLTFExporter().parseAsync(group, { binary: true, maxTextureSize: 2048 })
  const textures = new Set<THREE.Texture>()
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const material = mesh.material as THREE.MeshBasicMaterial
    if (material.map) textures.add(material.map)
    material.dispose()
  })
  textures.forEach((t) => t.dispose())
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
}
