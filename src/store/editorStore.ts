import { create } from 'zustand'
import type { RoomObject, TransformMode } from '../types'

/** 現在編集中の部屋(GLB本体を含む) */
export interface ActiveRoom {
  id: string
  name: string
  glbFileName: string
  glbData: Blob
  createdAt: string
  /** 一度でもIndexedDBに保存済みか(未保存ならGLB本体も書き込む必要がある) */
  persisted: boolean
}

export interface HistoryEntry {
  id: string
  before: RoomObject
  after: RoomObject
}

type ObjectPatch = Partial<Omit<RoomObject, 'id' | 'name'>>

export interface EditorState {
  screen: 'list' | 'editor'
  room: ActiveRoom | null
  /** GLB読み込み後に適用する保存済みの編集状態 */
  pendingOverrides: RoomObject[] | null
  objects: Record<string, RoomObject>
  objectOrder: string[]
  selectedId: string | null
  transformMode: TransformMode
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  /** ドラッグ中・カラーピッカー操作中など、確定前の変更の開始時点 */
  preview: { id: string; before: RoomObject } | null
  dirty: boolean

  showList: () => void
  openRoom: (room: ActiveRoom, overrides: RoomObject[] | null) => void
  /** GLBから抽出した初期状態を登録し、保存済みの編集状態があれば上書きする */
  initObjects: (base: RoomObject[]) => void
  renameActiveRoom: (name: string) => void
  select: (id: string | null) => void
  setTransformMode: (mode: TransformMode) => void
  /** 変更を即時確定し履歴に積む */
  updateObject: (id: string, patch: ObjectPatch) => void
  /** 履歴に積まずに変更する(連続操作用)。commitPreview で1件の履歴としてまとめる */
  previewObject: (id: string, patch: ObjectPatch) => void
  commitPreview: () => void
  deleteObject: (id: string) => void
  restoreObject: (id: string) => void
  undo: () => void
  redo: () => void
  markSaved: () => void
}

const HISTORY_LIMIT = 200

function sameObject(a: RoomObject, b: RoomObject) {
  return (
    a.color === b.color &&
    a.deleted === b.deleted &&
    a.position.every((v, i) => v === b.position[i]) &&
    a.rotation.every((v, i) => v === b.rotation[i])
  )
}

function applyPatch(obj: RoomObject, patch: ObjectPatch): RoomObject {
  return { ...obj, ...patch }
}

const initialEditorState = {
  room: null,
  pendingOverrides: null,
  objects: {},
  objectOrder: [],
  selectedId: null,
  undoStack: [],
  redoStack: [],
  preview: null,
  dirty: false,
} satisfies Partial<EditorState>

export const useEditorStore = create<EditorState>()((set, get) => {
  /** before→after の変更を確定し、履歴に積む */
  const commit = (before: RoomObject, after: RoomObject) => {
    if (sameObject(before, after)) return
    set((s) => ({
      objects: { ...s.objects, [after.id]: after },
      undoStack: [...s.undoStack, { id: after.id, before, after }].slice(-HISTORY_LIMIT),
      redoStack: [],
      dirty: true,
    }))
  }

  return {
    screen: 'list',
    transformMode: 'translate',
    ...initialEditorState,

    showList: () => set({ screen: 'list', ...initialEditorState }),

    openRoom: (room, overrides) =>
      set({ ...initialEditorState, screen: 'editor', room, pendingOverrides: overrides, dirty: !room.persisted }),

    initObjects: (base) => {
      const overrides = new Map((get().pendingOverrides ?? []).map((o) => [o.id, o]))
      const objects: Record<string, RoomObject> = {}
      for (const obj of base) {
        const saved = overrides.get(obj.id)
        objects[obj.id] = saved ? { ...saved, name: obj.name } : obj
      }
      set({ objects, objectOrder: base.map((o) => o.id), pendingOverrides: null })
    },

    renameActiveRoom: (name) =>
      set((s) => (s.room ? { room: { ...s.room, name }, dirty: true } : {})),

    select: (id) => {
      get().commitPreview()
      set({ selectedId: id })
    },

    setTransformMode: (transformMode) => set({ transformMode }),

    updateObject: (id, patch) => {
      get().commitPreview()
      const before = get().objects[id]
      if (!before) return
      commit(before, applyPatch(before, patch))
    },

    previewObject: (id, patch) => {
      const s = get()
      const current = s.objects[id]
      if (!current) return
      if (s.preview && s.preview.id !== id) s.commitPreview()
      set((st) => ({
        preview: st.preview ?? { id, before: current },
        objects: { ...st.objects, [id]: applyPatch(current, patch) },
      }))
    },

    commitPreview: () => {
      const { preview, objects } = get()
      if (!preview) return
      set({ preview: null })
      const after = objects[preview.id]
      if (after) commit(preview.before, after)
    },

    deleteObject: (id) => {
      get().updateObject(id, { deleted: true })
      if (get().selectedId === id) set({ selectedId: null })
    },

    restoreObject: (id) => get().updateObject(id, { deleted: false }),

    undo: () => {
      get().commitPreview()
      const { undoStack, redoStack, objects } = get()
      const entry = undoStack.at(-1)
      if (!entry) return
      set({
        objects: { ...objects, [entry.id]: entry.before },
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, entry],
        dirty: true,
      })
    },

    redo: () => {
      get().commitPreview()
      const { undoStack, redoStack, objects } = get()
      const entry = redoStack.at(-1)
      if (!entry) return
      set({
        objects: { ...objects, [entry.id]: entry.after },
        undoStack: [...undoStack, entry],
        redoStack: redoStack.slice(0, -1),
        dirty: true,
      })
    },

    markSaved: () => set((s) => ({ dirty: false, room: s.room ? { ...s.room, persisted: true } : null })),
  }
})
