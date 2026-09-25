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
  /** 隣り合う点の奥行きの比がこれを超えたら、別の物体の境目とみなして面を張らない */
  edgeThreshold?: number
  /** これより小さい破片は捨てる(格子セル数) */
  minPartCells?: number
  /** 個別パーツとして分ける最大数(残りは「その他」にまとめる) */
  maxParts?: number
}

const DEFAULTS = { columns: 256, edgeThreshold: 0.08, minPartCells: 40, maxParts: 24 }

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

class UnionFind {
  parent: Int32Array
  constructor(n: number) {
    this.parent = new Int32Array(n).map((_, i) => i)
  }
  find(a: number): number {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]]
      a = this.parent[a]
    }
    return a
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

/**
 * 写真と奥行きマップから、写真を貼った3Dメッシュ群を作る。
 * カメラは原点から -Z 方向を向いていたとみなして各画素を3D空間へ戻し、
 * 奥行きが大きく飛ぶ所(物体の輪郭)で面を切ることで、手前の家具などを別パーツに分ける。
 */
export function buildPhotoMeshes(image: HTMLCanvasElement, depth: DepthMap, options: PhotoMeshOptions) {
  const { columns, edgeThreshold, minPartCells, maxParts } = { ...DEFAULTS, ...options }
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
  for (let j = 0; j < vy; j++) {
    for (let i = 0; i < vx; i++) {
      const u = i / cols
      const v = j / rows
      const disparity = sampleBilinear(depth, u, v)
      const z = 1 / (disparity * (invNear - invFar) + invFar)
      const k = j * vx + i
      dist[k] = z
      positions[k * 3] = (u * 2 - 1) * tanX * z
      positions[k * 3 + 1] = (1 - v * 2) * tanY * z
      positions[k * 3 + 2] = -z
      uvs[k * 2] = u
      uvs[k * 2 + 1] = 1 - v
    }
  }

  // 奥行きが滑らかにつながっている格子セルだけを残す
  const cellCount = cols * rows
  const kept = new Uint8Array(cellCount)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = dist[j * vx + i]
      const b = dist[j * vx + i + 1]
      const c = dist[(j + 1) * vx + i]
      const d = dist[(j + 1) * vx + i + 1]
      const lo = Math.min(a, b, c, d)
      const hi = Math.max(a, b, c, d)
      if (hi / lo - 1 < edgeThreshold) kept[j * cols + i] = 1
    }
  }

  // 隣接する残ったセル同士をつなげて、ひと続きの面(パーツ)ごとにまとめる
  const uf = new UnionFind(cellCount)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i
      if (!kept[c]) continue
      if (i + 1 < cols && kept[c + 1]) uf.union(c, c + 1)
      if (j + 1 < rows && kept[c + cols]) uf.union(c, c + cols)
    }
  }
  const groups = new Map<number, number[]>()
  for (let c = 0; c < cellCount; c++) {
    if (!kept[c]) continue
    const root = uf.find(c)
    let list = groups.get(root)
    if (!list) groups.set(root, (list = []))
    list.push(c)
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

  // 最も低い点が床(y=0)に来るように全体を持ち上げる
  const box = new THREE.Box3().setFromObject(group)
  group.children.forEach((m) => (m.position.y -= box.min.y))
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
