import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { COCO_TO_KIND, FURNITURE } from '../three/furniture'
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

describe('estimateRoomLayout on an eye-level photo', () => {
  // サンプルの部屋を部屋の中から目の高さ(1.4m)で撮った画像に対する、実際のAIの出力(奥行き+家具検出)。
  // 正解: カメラから奥の壁まで5.2m・左の壁まで3.4m、右は壁なし。ソファ(2.0×0.85×0.9m)の中心まで4.6m、
  // 椅子(高さ0.9m)まで2.2m。家具検出にはソファとテーブルをまとめた誤検出(椅子 0.41)が含まれる
  const meta = JSON.parse(readFileSync(new URL('../three/__fixtures__/eye.json', import.meta.url), 'utf8'))
  const buf = readFileSync(new URL('../three/__fixtures__/eye.depth.bin', import.meta.url))
  const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
  const depth = { width: meta.width, height: meta.height, data: Float32Array.from(u16, (v) => v / 65535) }
  // CGの家具はAIの確信度が低め(ソファ 0.45)なので、足切りを下げて寸法の推定を確かめる
  const layout = estimateRoomLayout(depth, { width: meta.imageWidth, height: meta.imageHeight }, meta.detections, null, {
    focalLength35mm: 26,
    minScore: 0.4,
  })
  const find = (kind: string) => layout.furniture.filter((f) => f.kind === kind)
  const dist = (p: number[]) => Math.hypot(p[0], p[2])

  it('finds the walls at roughly the right distances', () => {
    expect(layout.walls).toEqual({ back: true, left: true, right: false })
    expect(-layout.minZ).toBeGreaterThan(4.4)
    expect(-layout.minZ).toBeLessThan(6)
    expect(-layout.minX).toBeGreaterThan(2.6)
    expect(-layout.minX).toBeLessThan(4.2)
  })

  it('drops the overlapping false detection and sizes the furniture', () => {
    expect(find('chair')).toHaveLength(1)
    expect(find('sofa')).toHaveLength(1)
    const [sofa] = find('sofa')
    const [chair] = find('chair')
    expect(dist(sofa.position)).toBeGreaterThan(3.8)
    expect(dist(sofa.position)).toBeLessThan(5.4)
    expect(sofa.size[0]).toBeGreaterThan(1.5)
    expect(sofa.size[0]).toBeLessThan(2.5)
    expect(sofa.size[2]).toBeLessThan(1.3)
    expect(chair.size[1]).toBeGreaterThan(0.75)
    expect(chair.size[1]).toBeLessThan(1.05)
    expect(dist(chair.position)).toBeGreaterThan(1.8)
    expect(dist(chair.position)).toBeLessThan(2.8)
    // 椅子は右手前、ソファは左奥
    expect(chair.position[0]).toBeGreaterThan(sofa.position[0])
  })

  it('treats a sofa-sized "chair" detection as a sofa', () => {
    // 描画のわずかな違いでソファが「椅子」と判定されることがある(実際にCIで発生)
    const relabelled = meta.detections.map((d: { label: string }) => (d.label === 'sofa' ? { ...d, label: 'chair', score: 0.3 } : d))
    const alt = estimateRoomLayout(depth, { width: meta.imageWidth, height: meta.imageHeight }, relabelled, null, {
      focalLength35mm: 26,
      minScore: 0.4,
    })
    expect(alt.furniture.map((f) => f.name).sort()).toEqual(['ソファ', '椅子'].sort())
  })
})

describe('estimateRoomLayout on real photos (COCO val2017)', () => {
  // 実写の室内写真8枚に対する実際のAIの出力(写真そのものは含まない)。COCO の正解ラベル付き
  const dir = new URL('../three/__fixtures__/real/', import.meta.url)
  const cases = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const meta = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
      const buf = readFileSync(new URL(f.replace('.json', '.depth.bin'), dir))
      const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
      const depth = { width: meta.width, height: meta.height, data: Float32Array.from(u16, (v) => v / 65535) }
      const layout = estimateRoomLayout(depth, { width: meta.imageWidth, height: meta.imageHeight }, meta.detections, null, {
        focalLength35mm: 26,
      })
      return { name: f, meta, layout }
    })

  it('has fixtures', () => expect(cases.length).toBeGreaterThanOrEqual(6))

  it.each(cases.map((c) => [c.name, c] as const))('%s: builds a plausible room', (_, { meta, layout }) => {
    // 部屋は現実的な広さ・高さ
    expect(layout.maxX - layout.minX).toBeLessThanOrEqual(10.01)
    expect(layout.maxZ - layout.minZ).toBeLessThanOrEqual(8.61)
    expect(layout.height).toBeGreaterThanOrEqual(2.4)
    expect(layout.height).toBeLessThanOrEqual(3.2)
    for (const f of layout.furniture) {
      const [w, h, d] = FURNITURE[f.kind].size
      // 寸法は種類ごとの標準から大きく外れない
      expect(f.size[0]).toBeGreaterThanOrEqual(w * 0.6 - 1e-6)
      expect(f.size[0]).toBeLessThanOrEqual(w * 1.6 + 1e-6)
      expect(f.size[1]).toBeGreaterThanOrEqual(h * 0.7 - 1e-6)
      expect(f.size[1]).toBeLessThanOrEqual(h * 1.4 + 1e-6)
      expect(f.size[2]).toBeLessThanOrEqual(d * 1.4 + 1e-6)
      // 浮かせてよいのはテレビ・電子レンジ・観葉植物だけ
      if (!['tv', 'microwave', 'plant'].includes(f.kind)) expect(f.position[1]).toBe(0)
      expect(f.position[1]).toBeLessThanOrEqual(2.2)
    }
    // 家具の数は正解から大きく外れない(誤検出で椅子だらけにならない)
    const truth = meta.groundTruth.filter((g: { name: string }) => COCO_TO_KIND[g.name]).length
    expect(layout.furniture.length).toBeLessThanOrEqual(truth + 2)
  })

  it('finds most of the labelled furniture across the photos', () => {
    let found = 0
    let truth = 0
    for (const { meta, layout } of cases) {
      const kinds = layout.furniture.map((f) => f.kind)
      for (const g of meta.groundTruth as { name: string }[]) {
        const kind = COCO_TO_KIND[g.name]
        if (!kind) continue
        truth++
        const i = kinds.indexOf(kind)
        if (i >= 0) {
          found++
          kinds.splice(i, 1)
        }
      }
    }
    expect(found / truth).toBeGreaterThan(0.6)
  })
})
