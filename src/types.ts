import type { FurnitureKind } from './three/furniture'

export type Vec3 = [number, number, number]

/** エディタで追加した家具(GLBには含まれず、この情報からテンプレートの形を作る) */
export interface FurnitureTemplate {
  kind: FurnitureKind
  size: Vec3
  color: string
}

/** GLB内の1ノード(メッシュ)に対する編集状態 */
export interface RoomObject {
  /** GLB内のノードパス(子インデックスを "/" で連結したもの)。名前重複があっても一意 */
  id: string
  name: string
  position: Vec3
  /** オイラー角(ラジアン, XYZ順) */
  rotation: Vec3
  /** 上書きした色(null は元の色を使用) */
  color: string | null
  deleted: boolean
  /** エディタで追加した家具のみ */
  template?: FurnitureTemplate
}

/** IndexedDBに保存する部屋のメタ情報 + 編集状態(GLB本体は別ストア) */
export interface RoomRecord {
  id: string
  name: string
  glbFileName: string
  objects: RoomObject[]
  thumbnail: string | null
  createdAt: string
  updatedAt: string
}

/** 部屋(要件定義 6.1)。glbData は IndexedDB の別ストアに保存する */
export interface Room extends RoomRecord {
  glbData: Blob
}

export type TransformMode = 'translate' | 'rotate'
