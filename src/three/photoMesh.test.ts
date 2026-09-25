import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { buildPhotoMeshes, edgeThresholdFor, longSideFov, segmentDisparity } from './photoMesh'
import type { DepthMap } from '../lib/depth'

// CanvasTexture は描画しない限り width/height があれば作れる
const fakeImage = (width: number, height: number) => ({ width, height }) as HTMLCanvasElement

/** 奥の壁(視差0)の手前に、中央の四角い物体(視差1)がある奥行きマップ */
function wallWithBox(w = 64, h = 48): DepthMap {
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data[y * w + x] = x > w * 0.35 && x < w * 0.65 && y > h * 0.4 && y < h * 0.8 ? 1 : 0
  return { data, width: w, height: h }
}

const meshes = (g: THREE.Group) => g.children.filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh[]

/** Depth Anything V2 が実際に出力した奥行きマップ(テスト素材) */
function fixture(name: 'room' | 'cats') {
  const meta = JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.depth.json`, import.meta.url), 'utf8'))
  const buf = readFileSync(new URL(`./__fixtures__/${name}.depth.bin`, import.meta.url))
  const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
  const depth: DepthMap = { width: meta.width, height: meta.height, data: Float32Array.from(u16, (v) => v / 65535) }
  return { depth, image: fakeImage(meta.imageWidth, meta.imageHeight) }
}

const cellCount = (m: THREE.Mesh) => m.geometry.getIndex()!.count / 6

describe('buildPhotoMeshes', () => {
  it('splits a foreground object from the background at depth discontinuities', () => {
    const group = buildPhotoMeshes(fakeImage(640, 480), wallWithBox(), {
      focalLength35mm: 26,
      near: 1,
      far: 4,
      columns: 64,
      minPartCells: 4,
    })
    expect(meshes(group).map((m) => m.name)).toEqual(['背景', 'パーツ1'])

    const [background, part] = meshes(group)
    const worldBox = (m: THREE.Mesh) => new THREE.Box3().setFromObject(m)
    // 物体は 1m 先、背景の壁は 4m 先
    expect(worldBox(part).max.z).toBeCloseTo(-1, 1)
    expect(worldBox(background).min.z).toBeCloseTo(-4, 1)
    // 物体は自分の中心に原点があり、全体の最下点は床(y=0)
    expect(part.geometry.boundingBox!.getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-6)
    const all = new THREE.Box3()
    meshes(group).forEach((m) => all.expandByObject(m))
    expect(all.min.y).toBeCloseTo(0, 6)
    // 撮影時のカメラ(元は原点)も一緒に持ち上がり、メッシュのIDがずれないよう最後の子になっている
    const camera = group.getObjectByName('PhotoCamera') as THREE.PerspectiveCamera
    expect(camera.isPerspectiveCamera).toBe(true)
    expect(camera.position.y).toBeGreaterThan(0)
    expect(group.children.at(-1)).toBe(camera)
  })

  it('keeps a smooth surface as a single part', () => {
    // 実際と同程度の細かさ(横128格子)なら、奥へ傾いた床も途切れない
    const w = 128
    const h = 96
    const data = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = y / (h - 1) // 床のように手前ほど近い
    const group = buildPhotoMeshes(fakeImage(640, 480), { data, width: w, height: h }, {
      focalLength35mm: 26,
      near: 1,
      far: 3,
      columns: 128,
    })
    expect(meshes(group)).toHaveLength(1)
    const index = meshes(group)[0].geometry.getIndex()!
    expect(index.count).toBe(128 * 96 * 6)
  })

  it('separates objects in real depth estimates', () => {
    // 猫2匹がソファに寝ている写真: 少なくとも片方の猫などが背景から分かれる
    const cats = fixture('cats')
    const catParts = meshes(buildPhotoMeshes(cats.image, cats.depth, { focalLength35mm: 26, near: 0.5, far: 5 }))
    const total = catParts.reduce((n, m) => n + cellCount(m), 0)
    expect(catParts.length).toBeGreaterThanOrEqual(3)
    expect(cellCount(catParts[1]) / total).toBeGreaterThan(0.1)

    // サンプルの部屋を撮った画像: 手前の椅子とテーブルの天板が分かれる
    const room = fixture('room')
    const roomParts = meshes(buildPhotoMeshes(room.image, room.depth, { focalLength35mm: 26, near: 0.5, far: 5 }))
    expect(roomParts.length).toBeGreaterThanOrEqual(3)
    // 輪郭をまたぐ面も背景側に含めるので、写真全体が隙間なく覆われる(捨てるのは小さな破片だけ)
    const kept = roomParts.reduce((n, m) => n + cellCount(m), 0)
    expect(kept / (256 * 194)).toBeGreaterThan(0.99)
  })

  it('splits more finely at higher sensitivity', () => {
    const { depth, image } = fixture('cats')
    const count = (sensitivity: number) =>
      meshes(buildPhotoMeshes(image, depth, { focalLength35mm: 26, near: 0.5, far: 5, sensitivity })).length
    expect(count(1)).toBeGreaterThanOrEqual(count(0))
    expect(edgeThresholdFor(0)).toBeGreaterThan(edgeThresholdFor(1))
  })

  it('assigns every point to a region', () => {
    const { depth } = fixture('room')
    const label = segmentDisparity(depth.data, depth.width, depth.height, edgeThresholdFor(0.5))
    expect(label.every((l) => l >= 0)).toBe(true)
  })

  it('uses a wider field of view for shorter focal lengths', () => {
    expect(THREE.MathUtils.radToDeg(longSideFov(26))).toBeCloseTo(69.4, 1)
    expect(longSideFov(13)).toBeGreaterThan(longSideFov(26))
  })
})
