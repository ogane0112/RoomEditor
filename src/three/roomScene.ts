import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { RoomLayout } from '../lib/roomLayout'
import { createFurnitureMesh, createSlab } from './furniture'

const WALL = 0.1
const FLOOR = 0.05

/** 推定したレイアウトから、床・壁・家具の3Dシーンを組み立てる(床の中心が原点) */
export function buildRoomScene(layout: RoomLayout) {
  const width = layout.maxX - layout.minX
  const depth = layout.maxZ - layout.minZ
  const cx = (layout.minX + layout.maxX) / 2
  const cz = (layout.minZ + layout.maxZ) / 2
  const h = layout.height

  const group = new THREE.Group()
  group.name = 'Room'
  const floor = createSlab('床', [width, FLOOR, depth], layout.floorColor)
  floor.position.set(0, -FLOOR / 2, 0)
  group.add(floor)
  if (layout.walls.back) {
    const wall = createSlab('奥の壁', [width + (layout.walls.left ? WALL : 0) + (layout.walls.right ? WALL : 0), h, WALL], layout.wallColor)
    wall.position.set(((layout.walls.right ? WALL : 0) - (layout.walls.left ? WALL : 0)) / 2, h / 2, -depth / 2 - WALL / 2)
    group.add(wall)
  }
  if (layout.walls.left) {
    const wall = createSlab('左の壁', [WALL, h, depth], layout.wallColor)
    wall.position.set(-width / 2 - WALL / 2, h / 2, 0)
    group.add(wall)
  }
  if (layout.walls.right) {
    const wall = createSlab('右の壁', [WALL, h, depth], layout.wallColor)
    wall.position.set(width / 2 + WALL / 2, h / 2, 0)
    group.add(wall)
  }

  for (const f of layout.furniture) {
    const mesh = createFurnitureMesh(f.kind, f.size, f.color, f.name)
    mesh.position.set(f.position[0] - cx, f.position[1], f.position[2] - cz)
    mesh.rotation.y = f.rotationY
    group.add(mesh)
  }
  return group
}

/** シーンをGLB(Blob)に書き出す。非表示(削除済み)のものは含めない */
export async function exportGLB(root: THREE.Object3D): Promise<Blob> {
  const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
}

export function disposeScene(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    ;(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose())
  })
}
