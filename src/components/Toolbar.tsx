import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { confirmDiscard, isGlbFile, openNewRoom, saveActiveRoom } from '../lib/rooms'

export function Toolbar() {
  const room = useEditorStore((s) => s.room)
  const dirty = useEditorStore((s) => s.dirty)
  const canUndo = useEditorStore((s) => s.undoStack.length > 0)
  const canRedo = useEditorStore((s) => s.redoStack.length > 0)
  const mode = useEditorStore((s) => s.transformMode)
  const { undo, redo, setTransformMode, renameActiveRoom, showList } = useEditorStore.getState()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    try {
      await saveActiveRoom()
      setMessage('保存しました')
    } catch (e) {
      setMessage(`保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 2500)
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1.5 border-b border-neutral-700 bg-neutral-800 px-2 text-sm md:gap-2 md:px-3">
      <button
        className="btn"
        onClick={() => confirmDiscard() && showList()}
        title="保存済みの部屋一覧へ戻る"
        aria-label="部屋一覧へ戻る"
      >
        ←<span className="hidden md:inline"> 部屋一覧</span>
      </button>
      <div className="hidden md:contents">
        <ImportButton />
      </div>

      <div className="mx-1 h-6 w-px bg-neutral-600 md:mx-2" />

      <button className="btn" onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)" aria-label="元に戻す">
        ↶<span className="hidden md:inline"> 元に戻す</span>
      </button>
      <button className="btn" onClick={redo} disabled={!canRedo} title="やり直し (Ctrl+Shift+Z)" aria-label="やり直し">
        ↷<span className="hidden md:inline"> やり直し</span>
      </button>

      <div className="mx-1 h-6 w-px bg-neutral-600 md:mx-2" />

      <div className="flex shrink-0 overflow-hidden rounded border border-neutral-600">
        {(
          [
            ['translate', '移動', 'W'],
            ['rotate', '回転', 'E'],
          ] as const
        ).map(([value, label, key]) => (
          <button
            key={value}
            className={`px-2.5 py-1 md:px-3 ${mode === value ? 'bg-sky-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}
            onClick={() => setTransformMode(value)}
          >
            {label}
            <span className="hidden md:inline"> ({key})</span>
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {room && (
        <input
          className="hidden w-56 min-w-0 rounded border border-transparent bg-transparent px-2 py-1 text-right font-medium text-neutral-100 hover:border-neutral-600 focus:border-sky-500 focus:outline-none md:block"
          value={room.name}
          onChange={(e) => renameActiveRoom(e.target.value)}
          aria-label="部屋の名前"
        />
      )}
      {message && (
        <span className="absolute top-full right-2 z-10 mt-2 rounded bg-neutral-700 px-3 py-1.5 text-xs text-neutral-100 shadow md:static md:mt-0 md:bg-transparent md:p-0 md:text-neutral-300 md:shadow-none">
          {message}
        </span>
      )}
      <button className="btn btn-primary shrink-0" onClick={save} disabled={saving || !room} title="保存 (Ctrl+S)">
        {saving ? '保存中…' : dirty ? '保存 *' : '保存'}
      </button>
    </header>
  )
}

export function ImportButton() {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button className="btn" onClick={() => input.current?.click()}>
        GLBインポート
      </button>
      <input
        ref={input}
        type="file"
        // accept を指定するとスマホで .glb が選択できない端末があるため、選択後に拡張子で検証する
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          if (!isGlbFile(file)) return window.alert('.glb ファイルを選択してください')
          if (confirmDiscard()) openNewRoom(file, file.name)
        }}
      />
    </>
  )
}
