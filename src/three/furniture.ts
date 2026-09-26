import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Vec3 } from '../types'

// 家具を種類ごとの簡単な形(テンプレート)で作る。
// 大きさ [幅, 高さ, 奥行き] に合わせて各部品の寸法を決め、原点は「床に接する底面の中心」、正面は +Z 向き。

export type FurnitureKind =
  | 'sofa'
  | 'chair'
  | 'table'
  | 'bed'
  | 'tv'
  | 'plant'
  | 'fridge'
  | 'toilet'
  | 'sink'
  | 'oven'
  | 'microwave'
  | 'box'

interface KindInfo {
  label: string
  /** 手動で追加するときや、奥行きを測れなかったときの標準寸法 [幅, 高さ, 奥行き](m) */
  size: Vec3
  /** 床から浮いた位置に置くのが普通か(手動追加時の高さ) */
  elevation?: number
  color: string
}

export const FURNITURE: Record<FurnitureKind, KindInfo> = {
  sofa: { label: 'ソファ', size: [2.0, 0.85, 0.9], color: '#5b6b7c' },
  chair: { label: '椅子', size: [0.5, 0.9, 0.5], color: '#a0522d' },
  table: { label: 'テーブル', size: [1.2, 0.72, 0.75], color: '#8b6b4a' },
  bed: { label: 'ベッド', size: [1.4, 0.9, 2.0], color: '#c9b79c' },
  tv: { label: 'テレビ', size: [1.2, 0.7, 0.08], elevation: 0.5, color: '#1f1f1f' },
  plant: { label: '観葉植物', size: [0.45, 1.1, 0.45], color: '#b07a4f' },
  fridge: { label: '冷蔵庫', size: [0.7, 1.8, 0.7], color: '#e8e8e8' },
  toilet: { label: 'トイレ', size: [0.4, 0.8, 0.7], color: '#f2f2f2' },
  sink: { label: 'シンク', size: [0.8, 0.9, 0.6], color: '#d9d9d9' },
  oven: { label: 'オーブン', size: [0.6, 0.9, 0.6], color: '#9a9a9a' },
  microwave: { label: '電子レンジ', size: [0.5, 0.3, 0.4], elevation: 0.9, color: '#d0d0d0' },
  box: { label: '家具', size: [0.6, 0.6, 0.6], color: '#9c8f80' },
}

/** 物体検出(COCOのラベル)→ 家具の種類 */
export const COCO_TO_KIND: Record<string, FurnitureKind> = {
  couch: 'sofa',
  sofa: 'sofa',
  bench: 'sofa',
  chair: 'chair',
  'dining table': 'table',
  diningtable: 'table',
  bed: 'bed',
  tv: 'tv',
  tvmonitor: 'tv',
  'potted plant': 'plant',
  pottedplant: 'plant',
  refrigerator: 'fridge',
  toilet: 'toilet',
  sink: 'sink',
  oven: 'oven',
  microwave: 'microwave',
}

type Part = { geometry: THREE.BufferGeometry; accent?: boolean }

function box(w: number, h: number, d: number, x: number, y: number, z: number, accent = false): Part {
  const geometry = new THREE.BoxGeometry(w, h, d).toNonIndexed()
  geometry.translate(x, y + h / 2, z)
  return { geometry, accent }
}

function legs(w: number, d: number, height: number, thickness: number, inset: number): Part[] {
  const x = w / 2 - inset - thickness / 2
  const z = d / 2 - inset - thickness / 2
  return [
    [-x, -z],
    [x, -z],
    [-x, z],
    [x, z],
  ].map(([lx, lz]) => box(thickness, height, thickness, lx, 0, lz, true))
}

function partsFor(kind: FurnitureKind, [w, h, d]: Vec3): Part[] {
  switch (kind) {
    case 'sofa': {
      const seatH = h * 0.5
      const arm = Math.min(w * 0.12, 0.25)
      const back = Math.min(d * 0.25, 0.3)
      return [
        box(w, seatH, d, 0, 0, 0),
        box(w, h - seatH, back, 0, seatH, -d / 2 + back / 2),
        box(arm, h * 0.72 - seatH, d, -w / 2 + arm / 2, seatH, 0),
        box(arm, h * 0.72 - seatH, d, w / 2 - arm / 2, seatH, 0),
      ]
    }
    case 'chair': {
      const seatY = h * 0.5
      const t = Math.min(w, d) * 0.08
      return [
        ...legs(w, d, seatY, t, 0),
        box(w, h * 0.06, d, 0, seatY, 0),
        box(w, h - seatY - h * 0.06, t, 0, seatY + h * 0.06, -d / 2 + t / 2),
      ]
    }
    case 'table': {
      const top = Math.min(h * 0.07, 0.05)
      return [...legs(w, d, h - top, Math.min(w, d) * 0.07, Math.min(w, d) * 0.04), box(w, top, d, 0, h - top, 0)]
    }
    case 'bed': {
      const base = h * 0.3
      const mattress = h * 0.25
      const head = Math.min(d * 0.06, 0.1)
      return [
        box(w, base, d, 0, 0, 0),
        box(w * 0.96, mattress, d - head, 0, base, head / 2, true),
        box(w, h, head, 0, 0, -d / 2 + head / 2),
      ]
    }
    case 'tv':
      return [box(w, h, Math.max(d, 0.04), 0, 0, 0), box(w * 0.94, h * 0.9, 0.005, 0, h * 0.05, d / 2 + 0.003, true)]
    case 'plant': {
      const potH = h * 0.3
      const pot = new THREE.CylinderGeometry(w * 0.35, w * 0.28, potH, 16).toNonIndexed()
      pot.translate(0, potH / 2, 0)
      const r = Math.min(w, d) / 2
      const leaves = new THREE.IcosahedronGeometry(1, 1)
      leaves.scale(r, (h - potH) / 2, r)
      leaves.translate(0, potH + (h - potH) / 2, 0)
      return [{ geometry: pot }, { geometry: leaves, accent: true }]
    }
    case 'toilet':
      return [
        box(w * 0.8, h * 0.5, d * 0.7, 0, 0, d * 0.15),
        box(w, h * 0.05, d * 0.7, 0, h * 0.5, d * 0.15, true),
        box(w, h * 0.45, d * 0.3, 0, h * 0.55, -d * 0.35),
      ]
    case 'sink':
      return [box(w, h * 0.92, d, 0, 0, 0), box(w, h * 0.08, d, 0, h * 0.92, 0, true)]
    case 'oven':
    case 'microwave':
    case 'fridge':
      return [box(w, h, d, 0, 0, 0), box(w * 0.9, h * 0.04, 0.02, 0, h * 0.8, d / 2 + 0.01, true)]
    case 'box':
      return [box(w, h, d, 0, 0, 0)]
  }
}

function accentColor(kind: FurnitureKind, main: THREE.Color) {
  if (kind === 'plant') return new THREE.Color('#4f7f3a')
  if (kind === 'bed') return new THREE.Color('#f4f1ea')
  if (kind === 'tv') return new THREE.Color('#0d1117')
  return main.clone().multiplyScalar(0.55)
}

/** 家具のメッシュを作る(本体色+差し色の2マテリアル。部品は1つの形状にまとめ、家具単位で選択・移動できる) */
export function createFurnitureMesh(kind: FurnitureKind, size: Vec3, color: string, name: string) {
  const parts = partsFor(kind, size)
  const main = parts.filter((p) => !p.accent).map((p) => p.geometry)
  const accent = parts.filter((p) => p.accent).map((p) => p.geometry)
  const groups = [mergeGeometries(main)]
  if (accent.length) groups.push(mergeGeometries(accent))
  const geometry = mergeGeometries(groups as THREE.BufferGeometry[], true)
  parts.forEach((p) => p.geometry.dispose())
  groups.forEach((g) => g?.dispose())
  geometry.computeVertexNormals()

  const mainColor = new THREE.Color(color)
  const materials = [new THREE.MeshStandardMaterial({ color: mainColor, roughness: 0.85 })]
  if (accent.length) materials.push(new THREE.MeshStandardMaterial({ color: accentColor(kind, mainColor), roughness: 0.7 }))
  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials)
  mesh.name = name
  mesh.userData.furniture = { kind, size }
  return mesh
}

/** 床・壁などの板(原点は板の中心) */
export function createSlab(name: string, size: Vec3, color: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }))
  mesh.name = name
  return mesh
}
