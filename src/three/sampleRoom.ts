import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// 手元にスキャンデータがなくても試せるよう、簡単な部屋をGLBとして生成する。
// 実際のスキャンGLBと同じ読み込み経路を通すため、一度GLBに書き出してから使う。

function box(name: string, size: [number, number, number], color: string, position: [number, number, number]) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  )
  mesh.name = name
  mesh.position.set(...position)
  return mesh
}

function furniture(name: string, parts: THREE.Mesh[], position: [number, number, number], rotationY = 0) {
  // 家具単位で選択できるよう、パーツをマージして1メッシュにする
  const geometries = parts.map((p) => {
    p.updateMatrix()
    return p.geometry.clone().applyMatrix4(p.matrix)
  })
  const merged = mergeBoxGeometries(geometries)
  const mesh = new THREE.Mesh(merged, (parts[0].material as THREE.Material).clone())
  mesh.name = name
  mesh.position.set(...position)
  mesh.rotation.y = rotationY
  return mesh
}

function mergeBoxGeometries(geometries: THREE.BufferGeometry[]) {
  const positions: number[] = []
  const normals: number[] = []
  for (const g of geometries) {
    const geo = g.index ? g.toNonIndexed() : g
    positions.push(...(geo.getAttribute('position').array as Float32Array))
    normals.push(...(geo.getAttribute('normal').array as Float32Array))
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return merged
}

export function buildSampleRoom() {
  const room = new THREE.Group()
  room.name = 'SampleRoom'

  const W = 5
  const D = 4
  const H = 2.4
  room.add(box('Floor', [W, 0.05, D], '#c8a27a', [0, -0.025, 0]))
  room.add(box('Wall_Back', [W, H, 0.1], '#eeeae4', [0, H / 2, -D / 2]))
  room.add(box('Wall_Left', [0.1, H, D], '#e8e4dd', [-W / 2, H / 2, 0]))
  room.add(box('Rug', [2, 0.01, 1.4], '#8a9bb0', [0, 0.005, 0.2]))

  room.add(
    furniture(
      'Sofa',
      [
        box('seat', [2, 0.4, 0.9], '#5b6b7c', [0, 0.2, 0]),
        box('back', [2, 0.5, 0.2], '#5b6b7c', [0, 0.65, -0.35]),
        box('armL', [0.2, 0.25, 0.9], '#5b6b7c', [-0.9, 0.52, 0]),
        box('armR', [0.2, 0.25, 0.9], '#5b6b7c', [0.9, 0.52, 0]),
      ],
      [0, 0, -1.3],
    ),
  )

  room.add(
    furniture(
      'Table',
      [
        box('top', [1.1, 0.05, 0.6], '#7a5a3a', [0, 0.42, 0]),
        box('leg1', [0.05, 0.4, 0.05], '#7a5a3a', [-0.5, 0.2, -0.25]),
        box('leg2', [0.05, 0.4, 0.05], '#7a5a3a', [0.5, 0.2, -0.25]),
        box('leg3', [0.05, 0.4, 0.05], '#7a5a3a', [-0.5, 0.2, 0.25]),
        box('leg4', [0.05, 0.4, 0.05], '#7a5a3a', [0.5, 0.2, 0.25]),
      ],
      [0, 0, 0.2],
    ),
  )

  room.add(
    furniture(
      'Shelf',
      [
        box('side1', [0.04, 1.8, 0.35], '#d9c7a8', [-0.4, 0.9, 0]),
        box('side2', [0.04, 1.8, 0.35], '#d9c7a8', [0.4, 0.9, 0]),
        ...[0.02, 0.45, 0.9, 1.35, 1.78].map((y, i) => box(`board${i}`, [0.84, 0.03, 0.35], '#d9c7a8', [0, y, 0])),
      ],
      [-2.2, 0, 0.8],
      Math.PI / 2,
    ),
  )

  room.add(
    furniture(
      'Chair',
      [
        box('seat', [0.45, 0.05, 0.45], '#a0522d', [0, 0.45, 0]),
        box('back', [0.45, 0.45, 0.04], '#a0522d', [0, 0.7, -0.2]),
        ...[
          [-0.2, -0.2],
          [0.2, -0.2],
          [-0.2, 0.2],
          [0.2, 0.2],
        ].map(([x, z], i) => box(`leg${i}`, [0.04, 0.45, 0.04], '#a0522d', [x, 0.225, z])),
      ],
      [1.4, 0, 1.1],
      -Math.PI / 4,
    ),
  )

  room.add(box('Plant_Pot', [0.35, 0.4, 0.35], '#6b8e23', [2.1, 0.2, -1.6]))
  return room
}

/** サンプル部屋をGLB(Blob)として生成する */
export async function createSampleRoomGLB(): Promise<Blob> {
  const room = buildSampleRoom()
  const result = await new GLTFExporter().parseAsync(room, { binary: true })
  room.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
  })
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
}

/**
 * サンプルの部屋を、部屋の中から目の高さでスマホ撮影したような画像にする(写真3D化のテスト用)。
 * カメラ: 高さ 1.4m、35mm換算 26mm 相当の画角、横長 4:3
 */
export function renderSampleRoomPhoto(width = 1280, height = 960) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#d6d3cc')
  scene.add(buildSampleRoom())
  scene.add(new THREE.HemisphereLight('#ffffff', '#6b5a48', 1.8))
  const sun = new THREE.DirectionalLight('#ffffff', 1.6)
  sun.position.set(3, 6, 4)
  scene.add(sun)

  const tanY = 18 / 26 / (width / height)
  const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(tanY)), width / height, 0.05, 50)
  camera.position.set(0.9, 1.4, 3.2)
  camera.lookAt(-0.3, 0.7, -1.2)

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(width, height, false)
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/jpeg', 0.92)
  renderer.dispose()
  return url
}
