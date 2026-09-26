import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { RoomObject, Vec3 } from '../types'

// デコーダはアプリに同梱したものを使う(外部CDNへのリクエストを発生させない)
const dracoLoader = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`)

const loader = new GLTFLoader().setDRACOLoader(dracoLoader).setMeshoptDecoder(MeshoptDecoder)

/** GLB(Blob)をパースしてシーンを返す。すべてブラウザ内で完結する */
export async function parseGLB(blob: Blob): Promise<THREE.Group> {
  const buffer = await blob.arrayBuffer()
  const gltf = await loader.parseAsync(buffer, '')
  // マテリアルが複数ある1つのメッシュは、読み込むと「部品メッシュを束ねたグループ」になる。
  // 1つの物として選択・移動できるよう印を付けておく
  gltf.scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh && gltf.parser.associations.get(o)?.meshes !== undefined) o.userData.multiPrimitive = true
  })
  return gltf.scene
}

/** 1つの編集対象(メッシュ、または複数マテリアルのメッシュのグループ)か */
function isEditable(o: THREE.Object3D) {
  return (o as THREE.Mesh).isMesh || o.userData.multiPrimitive === true
}

function meshesOf(o: THREE.Object3D) {
  const meshes: THREE.Mesh[] = []
  o.traverse((c) => (c as THREE.Mesh).isMesh && meshes.push(c as THREE.Mesh))
  return meshes
}

type ColorMaterial = THREE.Material & { color: THREE.Color; map?: THREE.Texture | null }

interface MaterialOriginal {
  color: THREE.Color
  map: THREE.Texture | null
}

function hasColor(m: THREE.Material): m is ColorMaterial {
  return (m as Partial<ColorMaterial>).color instanceof THREE.Color
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

const round = (v: number) => Math.round(v * 1e6) / 1e6
const toVec3 = (v: { x: number; y: number; z: number }): Vec3 => [round(v.x), round(v.y), round(v.z)]

/**
 * シーン内のメッシュを編集可能なオブジェクトとして列挙する。
 * - IDはルートからの子インデックスのパス(名前が重複・空でも一意かつ再読込時に安定)
 * - マテリアルはメッシュごとに複製し、色変更が他のメッシュへ波及しないようにする
 */
export function extractEditableObjects(root: THREE.Object3D) {
  const objects: RoomObject[] = []
  const nodes = new Map<string, THREE.Object3D>()

  const walk = (node: THREE.Object3D, path: string) => {
    if (isEditable(node)) {
      prepareEditableMesh(node, path)
      objects.push({
        id: path,
        name: node.name || `Mesh ${objects.length + 1}`,
        position: toVec3(node.position),
        rotation: toVec3(node.rotation),
        color: null,
        deleted: false,
      })
      nodes.set(path, node)
      return
    }
    node.children.forEach((child, i) => walk(child, path ? `${path}/${i}` : String(i)))
  }
  root.children.forEach((child, i) => walk(child, String(i)))

  return { objects, nodes }
}

/**
 * 物を編集できる状態にする(グループなら中の部品メッシュすべて)。
 * マテリアルはメッシュごとに複製し(色変更が他の物へ波及しないように)、元の色を覚えておく
 */
export function prepareEditableMesh(object: THREE.Object3D, id: string) {
  object.userData.roomObjectId = id
  for (const mesh of meshesOf(object)) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone()
    const originals: (MaterialOriginal | null)[] = materialsOf(mesh).map((m) =>
      hasColor(m) ? { color: m.color.clone(), map: m.map ?? null } : null,
    )
    // クリックで当たるのは部品メッシュなので、部品にも持ち主のIDを付ける
    mesh.userData.roomObjectId = id
    mesh.userData.materialOriginals = originals
  }
}

/** 編集状態を物へ反映する */
export function applyObjectState(object: THREE.Object3D, obj: RoomObject) {
  // GLB に書き出したときの名前にもなる
  object.name = obj.name
  object.position.fromArray(obj.position)
  object.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2])
  object.visible = !obj.deleted

  for (const mesh of meshesOf(object)) {
    const originals = mesh.userData.materialOriginals as (MaterialOriginal | null)[]
    materialsOf(mesh).forEach((m, i) => {
      const original = originals[i]
      if (!original || !hasColor(m)) return
      // 色を上書きする場合はテクスチャを外し、指定色をそのまま見せる
      const map = obj.color ? null : original.map
      if (m.map !== map) {
        m.map = map
        m.needsUpdate = true
      }
      if (obj.color) m.color.set(obj.color)
      else m.color.copy(original.color)
    })
  }
}

/** 元のマテリアル色(カラーピッカーの初期値用) */
export function originalColorHex(object: THREE.Object3D): string | null {
  for (const mesh of meshesOf(object)) {
    const originals = mesh.userData.materialOriginals as (MaterialOriginal | null)[] | undefined
    const first = originals?.find((o) => o)
    if (first) return `#${first.color.getHexString()}`
  }
  return null
}

/** 自身または祖先が非表示なら true(削除済みメッシュをクリック対象から外すため) */
export function isHidden(object: THREE.Object3D) {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return true
  return false
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const m of materialsOf(mesh)) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose()
      m.dispose()
    }
    // 色上書き中はマテリアルから外れている元テクスチャも破棄する
    const originals = (mesh.userData.materialOriginals ?? []) as (MaterialOriginal | null)[]
    for (const original of originals) original?.map?.dispose()
  })
}
