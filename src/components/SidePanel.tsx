import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useEditorStore } from '../store/editorStore'
import { meshRegistry } from '../three/registry'
import { originalColorHex } from '../three/gltf'
import type { RoomObject } from '../types'

const PALETTE = ['#f5f5f4', '#1c1917', '#78716c', '#b45309', '#7c2d12', '#b91c1c', '#15803d', '#1d4ed8', '#7e22ce', '#f59e0b']

export function SidePanel() {
  const selected = useEditorStore((s) => (s.selectedId ? s.objects[s.selectedId] : null))
  // スマホでは画面下部のパネルになるため、オブジェクト一覧は折りたたみ可能にする
  const [listOpen, setListOpen] = useState(false)

  return (
    <aside className="flex max-h-[45dvh] w-full shrink-0 flex-col overflow-y-auto border-t border-neutral-700 bg-neutral-800 pb-[env(safe-area-inset-bottom)] text-sm text-neutral-200 md:max-h-none md:w-72 md:overflow-visible md:border-t-0 md:border-l md:pb-0">
      <section className="border-b border-neutral-700 p-3 md:p-4">
        <h2 className="mb-3 hidden text-xs font-semibold tracking-wider text-neutral-400 uppercase md:block">選択中のオブジェクト</h2>
        {selected ? (
          <ObjectDetails key={selected.id} obj={selected} />
        ) : (
          <p className="text-neutral-400">
            <span className="pointer-coarse:hidden">3Dビューでオブジェクトをクリックして選択してください</span>
            <span className="hidden pointer-coarse:inline">3Dビューのオブジェクトをタップして選択してください</span>
          </p>
        )}
      </section>
      <ObjectList open={listOpen} onToggle={() => setListOpen((v) => !v)} />
    </aside>
  )
}

function ObjectDetails({ obj }: { obj: RoomObject }) {
  const { updateObject, previewObject, commitPreview, deleteObject, restoreObject } = useEditorStore.getState()
  const mesh = meshRegistry.get(obj.id)
  const baseColor = mesh ? originalColorHex(mesh) : null
  const colorInput = useRef<HTMLInputElement>(null)

  // ピッカー操作中(input)はプレビュー、確定(change)で1件の履歴にまとめる
  useEffect(() => {
    const el = colorInput.current
    if (!el) return
    const onChange = () => commitPreview()
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [commitPreview])

  const deg = (r: number) => THREE.MathUtils.radToDeg(r).toFixed(1)

  return (
    <div className="space-y-3 md:space-y-4">
      <div>
        <div className="truncate text-base font-medium text-white" title={obj.name}>
          {obj.name}
        </div>
        <div className="hidden text-xs text-neutral-500 md:block">ID: {obj.id}</div>
      </div>

      <dl className="hidden grid-cols-[4rem_1fr] gap-y-1 font-mono text-xs md:grid">
        <dt className="text-neutral-400">位置</dt>
        <dd>{obj.position.map((v) => v.toFixed(3)).join(', ')}</dd>
        <dt className="text-neutral-400">回転(°)</dt>
        <dd>{obj.rotation.map(deg).join(', ')}</dd>
      </dl>

      {baseColor !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-neutral-400">色</span>
            {obj.color && (
              <button className="text-xs text-sky-400 hover:underline" onClick={() => updateObject(obj.id, { color: null })}>
                元の色に戻す
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={colorInput}
              type="color"
              aria-label="色を選択"
              className="h-9 w-12 cursor-pointer rounded border border-neutral-600 bg-transparent"
              value={obj.color ?? baseColor}
              onInput={(e) => previewObject(obj.id, { color: e.currentTarget.value })}
              onChange={() => {}}
              disabled={obj.deleted}
            />
            <span className="font-mono text-xs text-neutral-400">{obj.color ?? `${baseColor}(元の色)`}</span>
          </div>
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`h-8 w-8 shrink-0 rounded border md:h-6 md:w-6 ${obj.color === c ? 'border-white ring-2 ring-sky-500' : 'border-neutral-600'}`}
                style={{ backgroundColor: c }}
                title={c}
                aria-label={`色 ${c}`}
                disabled={obj.deleted}
                onClick={() => updateObject(obj.id, { color: c })}
              />
            ))}
          </div>
        </div>
      )}

      {obj.deleted ? (
        <button className="btn w-full justify-center" onClick={() => restoreObject(obj.id)}>
          復元する
        </button>
      ) : (
        <button className="btn btn-danger w-full justify-center" onClick={() => deleteObject(obj.id)}>
          削除<span className="hidden md:inline"> (Delete)</span>
        </button>
      )}
    </div>
  )
}

function ObjectList({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const order = useEditorStore((s) => s.objectOrder)
  const objects = useEditorStore((s) => s.objects)
  const selectedId = useEditorStore((s) => s.selectedId)
  const select = useEditorStore((s) => s.select)

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <h2 className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
        <button
          className="flex w-full items-center justify-between px-4 py-3 text-left md:pointer-events-none md:pt-4 md:pb-2"
          onClick={onToggle}
          aria-expanded={open}
        >
          オブジェクト一覧 ({order.length})
          <span className="md:hidden">{open ? '▲' : '▼'}</span>
        </button>
      </h2>
      <ul className={`min-h-0 flex-1 overflow-y-auto pb-2 ${open ? '' : 'hidden'} md:block`}>
        {order.map((id) => {
          const obj = objects[id]
          if (!obj) return null
          return (
            <li key={id}>
              <button
                className={`flex w-full items-center gap-2 px-4 py-2.5 text-left md:py-1.5 ${
                  id === selectedId ? 'bg-sky-700/60 text-white' : 'hover:bg-neutral-700'
                } ${obj.deleted ? 'text-neutral-500 line-through' : ''}`}
                onClick={() => select(id)}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm border border-neutral-600"
                  style={{ backgroundColor: obj.color ?? 'transparent' }}
                />
                <span className="truncate">{obj.name}</span>
                {obj.deleted && <span className="ml-auto text-xs no-underline">削除済み</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
