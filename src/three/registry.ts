import type * as THREE from 'three'

// Three.jsのオブジェクトはシリアライズできないためZustandには入れず、ここで参照を保持する。

/** 読み込んだ部屋のシーン(GLB書き出し用) */
export const roomScene: { current: THREE.Object3D | null } = { current: null }

/** 編集可能オブジェクトID → 物(メッシュ、または複数マテリアルのメッシュのグループ) */
export const meshRegistry = new Map<string, THREE.Object3D>()

/** TransformControls操作直後のクリックで選択が外れないようにするためのフラグ */
export const gizmoState = { active: false }

/** Canvas内で登録される、現在のビューをサムネイル画像にする関数 */
export const thumbnailCapture: { current: (() => string | null) | null } = { current: null }
