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
    expect(store().objects.a).toMatchObject({ name: 'a', color: '#ff0000', deleted: true })
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
})
