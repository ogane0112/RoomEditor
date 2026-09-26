// 写真の奥行きマップと家具の検出結果から、部屋を簡単な形(床・壁・家具のテンプレート)で表すレイアウトを推定する。
// AI が出す奥行きは相対値なので、次の仮定で実寸に直す:
// - 床は平ら(一番大きな上向きの平面を床とみなし、ここを y=0 にする)
// - 写真は床から約 1.4m の高さで撮られている(スマホを構えた高さ)
// - 壁は床に垂直で、互いに直交している
import { COCO_TO_KIND, FURNITURE, type FurnitureKind } from '../three/furniture'
import type { Vec3 } from '../types'
import type { DepthMap } from './depth'
import type { Detection } from './detect'

export interface LayoutFurniture {
  name: string
  kind: FurnitureKind
  /** 底面中心の位置(m) */
  position: Vec3
  rotationY: number
  size: Vec3
  color: string
}

export interface RoomLayout {
  /** 床の範囲(m) */
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  height: number
  walls: { back: boolean; left: boolean; right: boolean }
  floorColor: string
  wallColor: string
  furniture: LayoutFurniture[]
}

export interface LayoutOptions {
  /** 35mm換算の焦点距離(mm) */
  focalLength35mm: number
  /** 撮影した高さ(m) */
  cameraHeight?: number
  /** 推定に使う格子の横の点数 */
  gridColumns?: number
  /** 家具とみなす検出の最低スコア */
  minScore?: number
  /** 椅子などの標準的な高さから縮尺を補正するか(既定: する) */
  autoScale?: boolean
}

type V3 = [number, number, number]

const DEFAULT_WALL_HEIGHT = 2.4

// ---- 小さなベクトル・統計ヘルパー ----
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2])
const normalize = (a: V3): V3 => {
  const n = norm(a) || 1
  return [a[0] / n, a[1] / n, a[2] / n]
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return NaN
  const sorted = Float64Array.from(values).sort()
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[i]
}

/** 再現性のある乱数(RANSAC 用) */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

interface Plane {
  normal: V3
  /** normal・p + d = 0 */
  d: number
  inliers: number[]
}

/** RANSAC で平面を当てはめる。accept で法線の向きを制限する */
function fitPlane(points: V3[], candidates: number[], threshold: number, accept: (n: V3) => boolean, seed: number): Plane | null {
  if (candidates.length < 30) return null
  const random = rng(seed)
  let best: Plane | null = null
  for (let iter = 0; iter < 300; iter++) {
    const a = points[candidates[Math.floor(random() * candidates.length)]]
    const b = points[candidates[Math.floor(random() * candidates.length)]]
    const c = points[candidates[Math.floor(random() * candidates.length)]]
    const n0 = cross(sub(b, a), sub(c, a))
    if (norm(n0) < 1e-9) continue
    const normal = normalize(n0)
    if (!accept(normal)) continue
    const d = -dot(normal, a)
    const inliers: number[] = []
    for (const i of candidates) if (Math.abs(dot(normal, points[i]) + d) < threshold) inliers.push(i)
    if (!best || inliers.length > best.inliers.length) best = { normal, d, inliers }
  }
  if (!best) return null
  // 当てはまった点で平面を最小二乗(共分散の最小固有ベクトル)で整える
  return refinePlane(points, best, accept)
}

function refinePlane(points: V3[], plane: Plane, accept: (n: V3) => boolean): Plane {
  const idx = plane.inliers
  const c: V3 = [0, 0, 0]
  for (const i of idx) for (let k = 0; k < 3; k++) c[k] += points[i][k] / idx.length
  const m = [0, 0, 0, 0, 0, 0] // xx xy xz yy yz zz
  for (const i of idx) {
    const [x, y, z] = sub(points[i], c)
    m[0] += x * x
    m[1] += x * y
    m[2] += x * z
    m[3] += y * y
    m[4] += y * z
    m[5] += z * z
  }
  // 最小固有ベクトルを逆反復法で求める(元の法線を初期値に)
  const A = [
    [m[0], m[1], m[2]],
    [m[1], m[3], m[4]],
    [m[2], m[4], m[5]],
  ]
  const shift = 1e-9 * (m[0] + m[3] + m[5] + 1)
  let v: V3 = plane.normal
  for (let iter = 0; iter < 20; iter++) {
    const w = solve3(A, v, shift)
    if (!w) break
    v = normalize(w)
  }
  if (dot(v, plane.normal) < 0) v = [-v[0], -v[1], -v[2]]
  if (!accept(v)) return plane
  return { normal: v, d: -dot(v, c), inliers: plane.inliers }
}

/** (A + shift I) x = b を解く */
function solve3(A: number[][], b: V3, shift: number): V3 | null {
  const a = A.map((row, i) => row.map((v, j) => v + (i === j ? shift : 0)))
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(a)
  if (Math.abs(D) < 1e-300) return null
  const col = (k: number) => a.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D]
}

function hex(r: number, g: number, b: number) {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function medianColor(colors: Uint8ClampedArray | null, indices: number[], fallback: string) {
  if (!colors || indices.length === 0) return fallback
  const ch = (k: number) => percentile(indices.map((i) => colors[i * 4 + k]), 0.5)
  return hex(ch(0), ch(1), ch(2))
}

function iou(a: Detection['box'], b: Detection['box']) {
  const x = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin))
  const y = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin))
  const inter = x * y
  const area = (r: Detection['box']) => (r.xmax - r.xmin) * (r.ymax - r.ymin)
  return inter / (area(a) + area(b) - inter || 1)
}

/**
 * レイアウトを推定する。
 * @param colors 格子と同じ大きさ(gridColumns × 行数)の RGBA。null なら既定色を使う
 */
export function estimateRoomLayout(
  depth: DepthMap,
  imageSize: { width: number; height: number },
  detections: Detection[],
  colors: Uint8ClampedArray | null,
  options: LayoutOptions,
): RoomLayout {
  const cameraHeight = options.cameraHeight ?? 1.4
  const minScore = options.minScore ?? 0.5
  const { gw, gh } = gridSize(imageSize, options.gridColumns)
  const aspect = imageSize.width / imageSize.height
  const tanLong = Math.tan(Math.atan(18 / options.focalLength35mm))
  const tanX = aspect >= 1 ? tanLong : tanLong * aspect
  const tanY = aspect >= 1 ? tanLong / aspect : tanLong

  // 家具の検出(重複を除き、家具の種類に対応するものだけ)
  const pieces = detections
    .filter((d) => d.score >= minScore && COCO_TO_KIND[d.label])
    .sort((a, b) => b.score - a.score)
    .filter((d, i, all) => !all.slice(0, i).some((e) => COCO_TO_KIND[e.label] === COCO_TO_KIND[d.label] && iou(e.box, d.box) > 0.5))
  // 格子上で「家具に覆われている点」を記録する(床・壁の推定から外すため)
  const covered = new Uint8Array(gw * gh)
  for (const d of pieces) {
    const x0 = Math.floor((d.box.xmin / imageSize.width) * gw)
    const x1 = Math.ceil((d.box.xmax / imageSize.width) * gw)
    const y0 = Math.floor((d.box.ymin / imageSize.height) * gh)
    const y1 = Math.ceil((d.box.ymax / imageSize.height) * gh)
    for (let y = Math.max(0, y0); y < Math.min(gh, y1); y++) for (let x = Math.max(0, x0); x < Math.min(gw, x1); x++) covered[y * gw + x] = 1
  }

  const disparity = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) disparity[y * gw + x] = sampleDepth(depth, (x + 0.5) / gw, (y + 0.5) / gh)

  // カメラ座標(右 +x, 上 +y, 奥 -z)の点群を作る。相対視差→距離の変換の「ずれ(near/far の比)」は未知なので、
  // いくつか試して、床と壁が一番平らになる(平面によく乗る)ものを選ぶ
  const floorCandidates: number[] = []
  const upperCandidates: number[] = []
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      if (covered[i]) continue
      if (y > gh * 0.45) floorCandidates.push(i)
      else upperCandidates.push(i)
    }

  const isFloorNormal = (n: V3) => n[1] > 0.7 // カメラの傾きは ±45° 以内とみなす
  let best: { points: V3[]; floor: Plane | null; score: number } | null = null
  for (const ratio of [3, 5, 8, 13, 21]) {
    const points = backProject(disparity, gw, gh, tanX, tanY, 1, ratio)
    const scale = percentile(floorCandidates.map((i) => -points[i][2]), 0.5) || 1
    const floor = fitPlane(points, floorCandidates, scale * 0.02, (n) => isFloorNormal(n) || isFloorNormal([-n[0], -n[1], -n[2]]), 1)
    const wall = fitPlane(points, upperCandidates, scale * 0.02, () => true, 2)
    const score = (floor?.inliers.length ?? 0) / Math.max(1, floorCandidates.length) + (wall?.inliers.length ?? 0) / Math.max(1, upperCandidates.length)
    if (!best || score > best.score) best = { points, floor, score }
  }
  const { points } = best!
  let floor = best!.floor
  if (floor && floor.normal[1] < 0) floor = { normal: [-floor.normal[0], -floor.normal[1], -floor.normal[2]], d: -floor.d, inliers: floor.inliers }
  // 床が見つからなければ、カメラは水平で、写っている一番低い所が床とみなす
  if (!floor || floor.inliers.length < floorCandidates.length * 0.1) {
    const low = percentile(floorCandidates.map((i) => points[i][1]), 0.05)
    floor = { normal: [0, 1, 0], d: -low, inliers: floorCandidates.filter((i) => Math.abs(points[i][1] - low) < Math.abs(low) * 0.05) }
  }

  // 床の法線が +Y になるように回し、カメラの高さが cameraHeight になるよう拡大縮小する
  const up = floor.normal
  const cameraAboveFloor = Math.abs(floor.d) || 1
  const scale = cameraHeight / cameraAboveFloor
  const toLevel = rotationFromTo(up, [0, 1, 0])
  const level = (p: V3): V3 => {
    const r = applyRot(toLevel, p)
    return [r[0] * scale, r[1] * scale + cameraHeight, r[2] * scale]
  }
  let world = points.map(level)

  // 壁の向きに合わせて水平方向に回す(一番大きな垂直の平面を壁とする)
  const wallCandidates = [...Array(gw * gh).keys()].filter((i) => !covered[i] && world[i][1] > 0.25)
  const wall = fitPlane(world, wallCandidates, 0.05, (n) => Math.abs(n[1]) < 0.2, 3)
  let yaw = 0
  if (wall && wall.inliers.length > wallCandidates.length * 0.1) {
    const angle = Math.atan2(wall.normal[0], wall.normal[2])
    // 直交する壁のどれかにそろえる(回転が最小になる90°刻みの向き)
    yaw = -(angle - Math.round(angle / (Math.PI / 2)) * (Math.PI / 2))
  }
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const turn = (p: V3): V3 => [p[0] * cy + p[2] * sy, p[1], -p[0] * sy + p[2] * cy]
  world = world.map(turn)
  const toWorld = (p: V3) => turn(level(p))

  // ---- 部屋の範囲と壁 ----
  // 向きをそろえた後は、壁は x=一定 または z=一定 の面になる。床より高い点の x・z の分布で、
  // 点が一か所に集中していて、しかも縦に広がっている所を壁とみなす
  const structure = [...Array(gw * gh).keys()].filter((i) => !covered[i])
  const raised = structure.filter((i) => world[i][1] > 0.3)
  const findWall = (axis: 0 | 2, side: 'min' | 'max') => {
    const bin = 0.05
    const hist = new Map<number, number[]>()
    for (const i of raised) {
      const k = Math.round(world[i][axis] / bin)
      let list = hist.get(k)
      if (!list) hist.set(k, (list = []))
      list.push(i)
    }
    const keys = [...hist.keys()].sort((a, b) => (side === 'min' ? a - b : b - a))
    for (const k of keys) {
      const band = [k - 1, k, k + 1].flatMap((j) => hist.get(j) ?? [])
      if (band.length < Math.max(20, raised.length * 0.04)) continue
      const ys = band.map((i) => world[i][1])
      if (percentile(ys, 0.9) - percentile(ys, 0.1) < 0.6) continue
      return percentile(band.map((i) => world[i][axis]), 0.5)
    }
    return null
  }
  const backZ = findWall(2, 'min')
  const leftX = findWall(0, 'min')
  const rightX = findWall(0, 'max')
  const walls = { back: backZ !== null, left: leftX !== null, right: rightX !== null && (leftX === null || rightX - leftX > 1) }

  // 壁がない方向は、見えている床の端まで(遠すぎる所は除く)
  const floorNear = structure.filter((i) => Math.abs(world[i][1]) < 0.1 && Math.hypot(world[i][0], world[i][2]) < 8)
  const fx = floorNear.map((i) => world[i][0])
  const fz = floorNear.map((i) => world[i][2])
  let minX = walls.left ? leftX! : (percentile(fx, 0.02) || -2) - 0.3
  let maxX = walls.right ? rightX! : (percentile(fx, 0.98) || 2) + 0.3
  let minZ = walls.back ? backZ! : (percentile(fz, 0.02) || -4) - 0.3
  const maxZ = 0.6 // 撮影位置の少し手前まで床を伸ばす
  if (maxX - minX < 1.5) {
    const c = (maxX + minX) / 2
    minX = c - 0.75
    maxX = c + 0.75
  }
  if (maxZ - minZ < 1.5) minZ = maxZ - 1.5
  const wallPoints = raised.filter((i) => {
    const [x, , z] = world[i]
    return (walls.back && Math.abs(z - minZ) < 0.15) || (walls.left && Math.abs(x - minX) < 0.15) || (walls.right && Math.abs(x - maxX) < 0.15)
  })
  const height = Math.min(3.2, Math.max(DEFAULT_WALL_HEIGHT, percentile(wallPoints.map((i) => world[i][1]), 0.98) || 0))

  const floorIdx = structure.filter((i) => Math.abs(world[i][1]) < 0.08)
  const floorColor = medianColor(colors, floorIdx, '#c8a27a')
  const wallColor = medianColor(colors, wallPoints, '#eeeae4')

  // ---- 家具 ----
  const ray = (px: number, py: number): V3 => {
    const u = px / imageSize.width
    const v = py / imageSize.height
    return [(u * 2 - 1) * tanX, (1 - v * 2) * tanY, -1]
  }
  const cameraPos = toWorld([0, 0, 0])
  /** 画像上の点を通る視線(ワールド座標の向き) */
  const rayDir = (px: number, py: number) => normalize(sub(toWorld(ray(px, py)), cameraPos))
  const horizontal = (v: V3) => Math.hypot(v[0], v[2])

  const counts = new Map<FurnitureKind, number>()
  const total = new Map<FurnitureKind, number>()
  for (const d of pieces) total.set(COCO_TO_KIND[d.label], (total.get(COCO_TO_KIND[d.label]) ?? 0) + 1)

  const furniture: LayoutFurniture[] = []
  for (const d of pieces) {
    const kind = COCO_TO_KIND[d.label]
    const prior = FURNITURE[kind]
    const { xmin, xmax, ymin, ymax } = d.box
    const cx = (xmin + xmax) / 2

    // 箱の内側の点のうち、手前側(=家具そのもの)にある点だけを使う
    const inner: number[] = []
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const px = ((x + 0.5) / gw) * imageSize.width
        const py = ((y + 0.5) / gh) * imageSize.height
        const mx = (xmax - xmin) * 0.2
        const my = (ymax - ymin) * 0.08
        if (px > xmin + mx && px < xmax - mx && py > ymin + my && py < ymax - my) inner.push(y * gw + x)
      }
    const dist = (i: number) => horizontal(sub(world[i], cameraPos))
    const near = percentile(inner.map(dist), 0.3)
    const body = inner.filter((i) => dist(i) <= near * 1.25)
    if (!Number.isFinite(near) || body.length === 0) continue

    // 正面の下端: 箱の下端の視線が床(y=0)と交わる点。床に届かなければ(壁掛けのテレビ等)家具の距離で止める
    const bottom = rayDir(cx, ymax)
    let front: V3
    let base = 0
    const tFloor = bottom[1] < -0.02 ? cameraPos[1] / -bottom[1] : Infinity
    if (tFloor * horizontal(bottom) < near * 1.6) {
      front = [cameraPos[0] + bottom[0] * tFloor, 0, cameraPos[2] + bottom[2] * tFloor]
    } else {
      const t = near / Math.max(horizontal(bottom), 1e-6)
      front = [cameraPos[0] + bottom[0] * t, 0, cameraPos[2] + bottom[2] * t]
      base = Math.max(0, cameraPos[1] + bottom[1] * t)
      if (base < 0.25) base = 0
    }
    const frontDist = horizontal(sub(front, cameraPos))

    // 幅: 箱の左右の視線が、正面の距離でどれだけ離れているか
    const at = (dir: V3): V3 => {
      const t = frontDist / Math.max(horizontal(dir), 1e-6)
      return [cameraPos[0] + dir[0] * t, cameraPos[1] + dir[1] * t, cameraPos[2] + dir[2] * t]
    }
    const midY = (ymin + ymax) / 2
    const left = at(rayDir(xmin, midY))
    const right = at(rayDir(xmax, midY))
    const width = Math.min(4, Math.max(0.2, Math.hypot(right[0] - left[0], right[2] - left[2])))
    // 高さ: 2通りで測って幾何平均をとる
    // - 箱の上端の視線が正面の距離で通る高さ(見下ろした写真では、奥の上端を拾って高めに出る)
    // - 家具の点のうち一番高い所(AIの奥行きは小物を平たくしがちで、低めに出る)
    const top = at(rayDir(cx, ymin))
    const byRay = Math.max(0.1, top[1] - base)
    const tall = inner.filter((i) => dist(i) <= near * 1.4).map((i) => world[i][1])
    const byPoints = Math.max(0.1, percentile(tall, 0.97) - base)
    const height = Math.min(2.6, Number.isFinite(byPoints) ? Math.sqrt(byRay * Math.min(byPoints, byRay)) : byRay)
    // 奥行き: 見えている面の奥行きの広がりと、種類ごとの標準的な比率の間をとる
    const spread = percentile(body.map(dist), 0.9) - percentile(body.map(dist), 0.1)
    const typical = prior.size[2] * (width / prior.size[0]) ** 0.5
    const depthSize = Math.min(prior.size[2] * 1.6, Math.max(prior.size[2] * 0.5, Math.max(typical, spread)))

    // 底面の中心 = 正面の下端から、視線の水平方向へ奥行きの半分
    const dir = normalize([front[0] - cameraPos[0], 0, front[2] - cameraPos[2]])
    const position: Vec3 = [front[0] + dir[0] * (depthSize / 2), base, front[2] + dir[2] * (depthSize / 2)]
    // 部屋からはみ出さないように収める
    position[0] = Math.min(maxX - width / 2, Math.max(minX + width / 2, position[0]))
    position[2] = Math.min(maxZ, Math.max(minZ + depthSize / 2, position[2]))

    const n = (counts.get(kind) ?? 0) + 1
    counts.set(kind, n)
    furniture.push({
      name: (total.get(kind) ?? 1) > 1 ? `${prior.label}${n}` : prior.label,
      kind,
      position: position.map((v) => Math.round(v * 1000) / 1000) as Vec3,
      rotationY: 0,
      size: [width, height, depthSize].map((v) => Math.round(v * 1000) / 1000) as Vec3,
      color: medianColor(colors, body, prior.color),
    })
  }

  // 高さがほぼ決まっている家具(椅子・テーブル等)があれば、その実測との比で全体の縮尺を補正する
  // (撮影した高さの仮定 cameraHeight のずれを打ち消す)
  const reliable: FurnitureKind[] = ['chair', 'table', 'sofa', 'toilet', 'sink', 'oven', 'fridge']
  const ratios = furniture.filter((f) => reliable.includes(f.kind) && f.position[1] === 0).map((f) => FURNITURE[f.kind].size[1] / f.size[1])
  const k = ratios.length && options.autoScale !== false ? Math.min(1.6, Math.max(0.6, percentile(ratios, 0.5))) : 1
  const r = (v: number) => Math.round(v * k * 1000) / 1000
  for (const f of furniture) {
    f.position = f.position.map(r) as Vec3
    f.size = f.size.map(r) as Vec3
  }
  return {
    minX: minX * k,
    maxX: maxX * k,
    minZ: minZ * k,
    maxZ,
    height: Math.min(3.2, Math.max(DEFAULT_WALL_HEIGHT, height * k)),
    walls,
    floorColor,
    wallColor,
    furniture,
  }
}

/** 推定に使う格子の大きさ */
export function gridSize(imageSize: { width: number; height: number }, columns = 128) {
  return { gw: columns, gh: Math.max(8, Math.round((columns * imageSize.height) / imageSize.width)) }
}

function sampleDepth(depth: DepthMap, u: number, v: number) {
  const x = Math.min(depth.width - 1, Math.max(0, Math.floor(u * depth.width)))
  const y = Math.min(depth.height - 1, Math.max(0, Math.floor(v * depth.height)))
  return depth.data[y * depth.width + x]
}

/** 相対視差(0=最奥,1=最手前)を、手前 near・奥 far の距離に当てはめてカメラ座標の点にする */
function backProject(disparity: Float32Array, gw: number, gh: number, tanX: number, tanY: number, near: number, far: number): V3[] {
  const points: V3[] = new Array(gw * gh)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      const z = 1 / (disparity[i] * (1 / near - 1 / far) + 1 / far)
      const u = (x + 0.5) / gw
      const v = (y + 0.5) / gh
      points[i] = [(u * 2 - 1) * tanX * z, (1 - v * 2) * tanY * z, -z]
    }
  return points
}

type Rot = number[] // 3x3 行優先

/** 向き a を向き b に重ねる回転(ロドリゲスの公式) */
function rotationFromTo(a: V3, b: V3): Rot {
  const v = cross(a, b)
  const c = dot(a, b)
  if (c > 1 - 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const k = 1 / (1 + c)
  return [
    v[0] * v[0] * k + c,
    v[0] * v[1] * k - v[2],
    v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2],
    v[1] * v[1] * k + c,
    v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1],
    v[2] * v[1] * k + v[0],
    v[2] * v[2] * k + c,
  ]
}

function applyRot(r: Rot, p: V3): V3 {
  return [r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2], r[6] * p[0] + r[7] * p[1] + r[8] * p[2]]
}
