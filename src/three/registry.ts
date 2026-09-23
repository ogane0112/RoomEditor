import type * as THREE from 'three'

// Three.jsのオブジェクトはシリアライズできないためZustandには入れず、ここで参照を保持する。

/** 編集可能オブジェクトID → メッシュ */
export const meshRegistry = new Map<string, THREE.Mesh>()

/** TransformControls操作直後のクリックで選択が外れないようにするためのフラグ */
export const gizmoState = { active: false }

/** Canvas内で登録される、現在のビューをサムネイル画像にする関数 */
export const thumbnailCapture: { current: (() => string | null) | null } = { current: null }
