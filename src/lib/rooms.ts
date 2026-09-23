import { useEditorStore } from '../store/editorStore'
import { thumbnailCapture } from '../three/registry'
import { loadRoom, saveRoom } from './db'

/** GLBファイル(またはBlob)から新しい部屋を作成して編集画面を開く。保存するまでIndexedDBには書き込まない */
export function openNewRoom(glbData: Blob, fileName: string) {
  useEditorStore.getState().openRoom(
    {
      id: crypto.randomUUID(),
      name: fileName.replace(/\.glb$/i, '') || '新しい部屋',
      glbFileName: fileName,
      glbData,
      createdAt: new Date().toISOString(),
      persisted: false,
    },
    null,
  )
}

export async function openSavedRoom(id: string) {
  const room = await loadRoom(id)
  if (!room) throw new Error('部屋のデータが見つかりませんでした')
  const { objects, thumbnail: _thumbnail, updatedAt: _updatedAt, ...rest } = room
  useEditorStore.getState().openRoom({ ...rest, persisted: true }, objects)
}

/** 編集中の部屋(transform・色・削除フラグ)をIndexedDBに保存する */
export async function saveActiveRoom() {
  const state = useEditorStore.getState()
  state.commitPreview()
  const { room, objects, objectOrder } = useEditorStore.getState()
  if (!room) return

  await saveRoom(
    {
      id: room.id,
      name: room.name,
      glbFileName: room.glbFileName,
      objects: objectOrder.map((id) => objects[id]),
      thumbnail: thumbnailCapture.current?.() ?? null,
      createdAt: room.createdAt,
      updatedAt: new Date().toISOString(),
    },
    // GLB本体は初回保存時のみ書き込む(以降は不変)
    room.persisted ? undefined : room.glbData,
  )
  useEditorStore.getState().markSaved()
}

export function isGlbFile(file: File) {
  return /\.glb$/i.test(file.name)
}

/** 未保存の変更がある場合に破棄してよいか確認する */
export function confirmDiscard() {
  const { room, dirty } = useEditorStore.getState()
  if (!room || !dirty) return true
  return window.confirm('保存されていない変更があります。破棄してよろしいですか?')
}
