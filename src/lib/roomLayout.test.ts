import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { estimateRoomLayout } from './roomLayout'
import { buildRoomScene } from '../three/roomScene'
import type { Detection } from './detect'

// Depth Anything V2 が「サンプルの部屋」(5m×4m、奥と左に壁、幅2mのソファ等)のスクリーンショットから
// 実際に推定した奥行き。画像は約4.9mの高さから見下ろしたもの
function roomFixture() {
  const meta = JSON.parse(readFileSync(new URL('../three/__fixtures__/room.depth.json', import.meta.url), 'utf8'))
  const buf = readFileSync(new URL('../three/__fixtures__/room.depth.bin', import.meta.url))
  const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
  return {
    depth: { width: meta.width, height: meta.height, data: Float32Array.from(u16, (v) => v / 65535) },
    image: { width: meta.imageWidth as number, height: meta.imageHeight as number },
  }
}

const det = (label: string, xmin: number, ymin: number, xmax: number, ymax: number, score = 0.9): Detection => ({
  label,
  score,
  box: { xmin, ymin, xmax, ymax },
})

// 画像上の家具の位置(物体検出が返すのと同じ形式)
const detections = [
  det('chair', 535, 484, 628, 628),
  det('couch', 457, 302, 667, 434),
  det('dining table', 415, 399, 566, 504),
  det('couch', 460, 305, 660, 430, 0.6), // 重複検出は1つにまとめる
  det('person', 10, 10, 50, 50), // 家具でないものは無視
]

describe('estimateRoomLayout', () => {
  const { depth, image } = roomFixture()
  const layout = estimateRoomLayout(depth, image, detections, null, { focalLength35mm: 26, cameraHeight: 4.9, autoScale: false })
  const byName = Object.fromEntries(layout.furniture.map((f) => [f.name, f]))

  it('finds the back and left walls of the sample room', () => {
    expect(layout.walls).toMatchObject({ back: true, left: true })
    expect(layout.height).toBeCloseTo(2.4, 1)
  })

  it('turns detections into furniture with plausible real-world sizes', () => {
    expect(Object.keys(byName).sort()).toEqual(['テーブル', 'ソファ', '椅子'].sort())
    const [sofaW, sofaH] = byName['ソファ'].size
    const [, chairH] = byName['椅子'].size
    expect(sofaW).toBeGreaterThan(1.4) // 正解 2.0m
    expect(sofaW).toBeLessThan(2.6)
    expect(sofaH).toBeGreaterThan(0.6) // 正解 0.85m
    expect(sofaH).toBeLessThan(1.1)
    expect(chairH).toBeGreaterThan(0.7) // 正解 0.9m
    expect(chairH).toBeLessThan(1.2)
  })

  it('keeps the relative placement of the furniture', () => {
    const [sofa, table, chair] = ['ソファ', 'テーブル', '椅子'].map((n) => byName[n].position)
    // ソファが一番奥、テーブル、椅子の順に手前。椅子はソファより右
    expect(sofa[2]).toBeLessThan(table[2])
    expect(table[2]).toBeLessThan(chair[2])
    expect(chair[0]).toBeGreaterThan(sofa[0])
    // ソファの中心は左の壁から約2.5m
    expect(sofa[0] - layout.minX).toBeGreaterThan(1.8)
    expect(sofa[0] - layout.minX).toBeLessThan(3.2)
    // すべて床の上、部屋の中
    for (const f of layout.furniture) {
      expect(f.position[1]).toBe(0)
      expect(f.position[0]).toBeGreaterThanOrEqual(layout.minX)
      expect(f.position[2]).toBeGreaterThanOrEqual(layout.minZ)
    }
  })

  it('corrects the scale from furniture with typical heights', () => {
    // 撮影した高さの仮定(既定 1.4m)が実際(約4.9m)とずれていても、椅子などの高さから縮尺を補正する
    const scaled = estimateRoomLayout(depth, image, detections, null, { focalLength35mm: 26, cameraHeight: 3.5 })
    const chair = scaled.furniture.find((f) => f.kind === 'chair')!
    expect(chair.size[1]).toBeGreaterThan(0.75)
    expect(chair.size[1]).toBeLessThan(1.05)
  })

  it('builds a named, clean scene', () => {
    const scene = buildRoomScene(layout)
    expect(scene.children.map((o) => o.name)).toEqual(['床', '奥の壁', '左の壁', ...layout.furniture.map((f) => f.name)])
    const sofa = scene.getObjectByName('ソファ') as THREE.Mesh
    const box = new THREE.Box3().setFromObject(sofa)
    expect(box.min.y).toBeCloseTo(0, 5)
    expect(box.max.x - box.min.x).toBeCloseTo(byName['ソファ'].size[0], 3)
  })
})
