import { useCallback, useEffect, useState } from 'react'
import { deleteRoom, listRooms, renameRoom } from '../lib/db'
import { openNewRoom, openSavedRoom } from '../lib/rooms'
import { createSampleRoomGLB } from '../three/sampleRoom'
import type { RoomRecord } from '../types'
import { ImportButton } from './Toolbar'

export function RoomList() {
  const [rooms, setRooms] = useState<RoomRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    listRooms()
      .then(setRooms)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(refresh, [refresh])

  const open = (id: string) =>
    openSavedRoom(id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))

  const openSample = async () => openNewRoom(await createSampleRoomGLB(), 'サンプルの部屋.glb')

  return (
    <div className="h-full overflow-y-auto bg-neutral-900 text-neutral-200">
      <div className="mx-auto max-w-5xl px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6 md:py-10">
        <header className="mb-6 flex flex-wrap items-end gap-4 md:mb-8">
          <div className="min-w-60 flex-1">
            <h1 className="text-2xl font-bold text-white">RoomEditor</h1>
            <p className="mt-1 text-sm text-neutral-400">
              3DスキャンしたGLBを読み込んで、家具の移動・回転・色変更・削除ができます。
              データはすべてこのブラウザ内に保存され、外部には送信されません。
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <button className="btn" onClick={openSample}>
              サンプルの部屋を開く
            </button>
            <ImportButton />
          </div>
        </header>

        <div className="mb-8 rounded-lg border-2 border-dashed border-neutral-700 p-8 text-center text-neutral-400 pointer-coarse:hidden">
          .glb ファイルをこのウィンドウにドラッグ&ドロップすると新しい部屋として開きます
        </div>

        {error && <p className="mb-4 rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</p>}

        <h2 className="mb-3 text-sm font-semibold tracking-wider text-neutral-400 uppercase">保存済みの部屋</h2>
        {rooms === null ? (
          <p className="text-neutral-500">読み込み中…</p>
        ) : rooms.length === 0 ? (
          <p className="text-neutral-500">まだ保存された部屋はありません。</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] sm:gap-4">
            {rooms.map((room) => (
              <RoomCard key={room.id} room={room} onOpen={() => open(room.id)} onChanged={refresh} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function RoomCard({ room, onOpen, onChanged }: { room: RoomRecord; onOpen: () => void; onChanged: () => void }) {
  const rename = async () => {
    const name = window.prompt('部屋の名前', room.name)?.trim()
    if (!name || name === room.name) return
    await renameRoom(room.id, name)
    onChanged()
  }

  const remove = async () => {
    if (!window.confirm(`「${room.name}」を削除しますか?この操作は取り消せません。`)) return
    await deleteRoom(room.id)
    onChanged()
  }

  return (
    <li className="group overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800">
      <button className="block w-full text-left" onClick={onOpen}>
        <div className="aspect-[16/10] bg-neutral-950">
          {room.thumbnail ? (
            <img src={room.thumbnail} alt="" className="h-full w-full object-cover transition group-hover:opacity-80" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-600">No preview</div>
          )}
        </div>
        <div className="px-3 pt-2">
          <div className="truncate font-medium text-white">{room.name}</div>
          <div className="truncate text-xs text-neutral-500">
            {room.glbFileName} ・ {new Date(room.updatedAt).toLocaleString('ja-JP')}
          </div>
          <div className="text-xs text-neutral-500">
            {room.objects.length} オブジェクト
          </div>
        </div>
      </button>
      <div className="flex gap-4 px-3 py-2 text-xs">
        <button className="text-sky-400 hover:underline" onClick={rename}>
          名前を変更
        </button>
        <button className="text-red-400 hover:underline" onClick={remove}>
          削除
        </button>
      </div>
    </li>
  )
}
