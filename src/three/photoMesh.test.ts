import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildPhotoMeshes, longSideFov } from './photoMesh'
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

const meshes = (g: THREE.Group) => g.children as THREE.Mesh[]

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
    expect(new THREE.Box3().setFromObject(group).min.y).toBeCloseTo(0, 6)
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

  it('uses a wider field of view for shorter focal lengths', () => {
    expect(THREE.MathUtils.radToDeg(longSideFov(26))).toBeCloseTo(69.4, 1)
    expect(longSideFov(13)).toBeGreaterThan(longSideFov(26))
  })
})
