import { useEffect, useState } from 'react'
import { useEditorStore } from './store/editorStore'
import { confirmDiscard, isGlbFile, openNewRoom } from './lib/rooms'
import { RoomList } from './components/RoomList'
import { Toolbar } from './components/Toolbar'
import { Viewer } from './components/Viewer'
import { SidePanel } from './components/SidePanel'

export function App() {
  const screen = useEditorStore((s) => s.screen)
  const roomId = useEditorStore((s) => s.room?.id)
  const dragging = useGlbDrop()
  useShortcuts()
  useUnsavedChangesWarning()

  return (
    <div className="relative flex h-full flex-col">
      {screen === 'editor' && roomId ? (
        <>
          <Toolbar />
          <main className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="min-h-0 min-w-0 flex-1">
              {/* 部屋が切り替わったらビューアを作り直す */}
              <Viewer key={roomId} />
            </div>
            <SidePanel />
          </main>
        </>
      ) : (
        <RoomList />
      )}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-4 border-dashed border-sky-500 bg-sky-500/10 text-lg font-semibold text-sky-200">
          ドロップしてGLBを読み込む
        </div>
      )}
    </div>
  )
}

/** ウィンドウ全体でGLBファイルのドラッグ&ドロップを受け付ける */
function useGlbDrop() {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = Array.from(e.dataTransfer?.files ?? []).find(isGlbFile)
      if (!file) return window.alert('.glb ファイルをドロップしてください')
      if (confirmDiscard()) openNewRoom(file, file.name)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return dragging
}

function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useEditorStore.getState()
      if (s.screen !== 'editor') return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return

      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
      } else if (mod) {
        return
      } else if (key === 'w') {
        s.setTransformMode('translate')
      } else if (key === 'e') {
        s.setTransformMode('rotate')
      } else if (key === 'escape') {
        s.select(null)
      } else if ((key === 'delete' || key === 'backspace') && s.selectedId) {
        e.preventDefault()
        s.deleteObject(s.selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

function useUnsavedChangesWarning() {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const { room, dirty } = useEditorStore.getState()
      if (room && dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
}
