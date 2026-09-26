import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editorStore'
import type { RoomObject } from '../types'

const base = (id: string): RoomObject => ({
  id,
  name: id,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  color: null,
  deleted: false,
})

const store = () => useEditorStore.getState()

beforeEach(() => {
  store().openRoom(
    { id: 'r', name: 'r', glbFileName: 'r.glb', glbData: new Blob(), createdAt: '', persisted: true },
    null,
  )
  store().initObjects([base('a'), base('b')])
})

describe('editorStore', () => {
  it('applies saved overrides when objects are initialised', () => {
    store().openRoom(
      { id: 'r', name: 'r', glbFileName: 'r.glb', glbData: new Blob(), createdAt: '', persisted: true },
      [{ ...base('a'), name: 'old', color: '#ff0000', deleted: true }],
    )
    store().initObjects([base('a'), base('b')])
    // 保存した名前(ユーザーが付けた名前)を優先する
    expect(store().objects.a).toMatchObject({ name: 'old', color: '#ff0000', deleted: true })
    expect(store().objects.b.color).toBeNull()
    expect(store().objectOrder).toEqual(['a', 'b'])
  })

  it('undoes and redoes color changes and deletions', () => {
    store().updateObject('a', { color: '#00ff00' })
    store().select('b')
    store().deleteObject('b')
    expect(store().selectedId).toBeNull()
    expect(store().objects.b.deleted).toBe(true)

    store().undo()
    expect(store().objects.b.deleted).toBe(false)
    store().undo()
    expect(store().objects.a.color).toBeNull()
    store().undo() // no-op on empty stack
    expect(store().redoStack).toHaveLength(2)

    store().redo()
    expect(store().objects.a.color).toBe('#00ff00')
    store().redo()
    expect(store().objects.b.deleted).toBe(true)
    expect(store().dirty).toBe(true)
  })

  it('collapses a preview sequence into a single history entry', () => {
    store().previewObject('a', { position: [1, 0, 0] })
    store().previewObject('a', { position: [2, 0, 0] })
    store().previewObject('a', { position: [3, 0, 0] })
    expect(store().undoStack).toHaveLength(0)
    store().commitPreview()
    expect(store().undoStack).toHaveLength(1)

    store().undo()
    expect(store().objects.a.position).toEqual([0, 0, 0])
  })

  it('does not record no-op changes and clears redo on new edits', () => {
    store().updateObject('a', { color: null })
    expect(store().undoStack).toHaveLength(0)

    store().updateObject('a', { color: '#111111' })
    store().undo()
    store().updateObject('b', { rotation: [0, 1, 0] })
    expect(store().redoStack).toHaveLength(0)
  })

  it('adds furniture as an undoable operation and restores it from saved data', () => {
    const chair: RoomObject = {
      ...base('f-1'),
      name: '椅子',
      template: { kind: 'chair', size: [0.5, 0.9, 0.5], color: '#a0522d' },
    }
    store().addObject(chair)
    expect(store().objects['f-1'].deleted).toBe(false)
    expect(store().objectOrder).toEqual(['a', 'b', 'f-1'])
    expect(store().selectedId).toBe('f-1')

    store().undo()
    expect(store().objects['f-1'].deleted).toBe(true)
    store().redo()
    expect(store().objects['f-1'].deleted).toBe(false)

    // 保存→再読込: GLBには無い家具も復元される
    const saved = Object.values(store().objects)
    store().openRoom(
      { id: 'r', name: 'r', glbFileName: 'r.glb', glbData: new Blob(), createdAt: '', persisted: true },
      saved,
    )
    store().initObjects([base('a'), base('b')])
    expect(store().objectOrder).toEqual(['a', 'b', 'f-1'])
    expect(store().objects['f-1'].template?.kind).toBe('chair')
  })

  it('renames objects without adding history', () => {
    store().updateObject('a', { color: '#123456' })
    store().renameObject('a', 'ソファ')
    expect(store().objects.a.name).toBe('ソファ')
    expect(store().undoStack).toHaveLength(1)
    expect(store().dirty).toBe(true)
    // 元に戻しても名前はそのまま
    store().undo()
    expect(store().objects.a).toMatchObject({ name: 'ソファ', color: null })
    store().redo()
    expect(store().objects.a).toMatchObject({ name: 'ソファ', color: '#123456' })
  })
})
