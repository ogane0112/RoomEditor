import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Room, RoomRecord } from '../types'

// すべてブラウザ内(IndexedDB)に保存し、外部へは一切送信しない。
// 一覧表示で巨大なGLBを読み込まないよう、メタ情報とGLB本体はストアを分けている。

interface RoomEditorDB extends DBSchema {
  rooms: { key: string; value: RoomRecord; indexes: { updatedAt: string } }
  glbs: { key: string; value: Blob }
}

const DB_NAME = 'room-editor'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<RoomEditorDB>> | null = null

function getDB() {
  dbPromise ??= openDB<RoomEditorDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const rooms = db.createObjectStore('rooms', { keyPath: 'id' })
      rooms.createIndex('updatedAt', 'updatedAt')
      db.createObjectStore('glbs')
    },
  })
  return dbPromise
}

/** 保存済みの部屋一覧(更新日時の新しい順) */
export async function listRooms(): Promise<RoomRecord[]> {
  const db = await getDB()
  const rooms = await db.getAllFromIndex('rooms', 'updatedAt')
  return rooms.reverse()
}

export async function loadRoom(id: string): Promise<Room | null> {
  const db = await getDB()
  const tx = db.transaction(['rooms', 'glbs'])
  const [record, glbData] = await Promise.all([
    tx.objectStore('rooms').get(id),
    tx.objectStore('glbs').get(id),
    tx.done,
  ])
  if (!record || !glbData) return null
  return { ...record, glbData }
}

/** 部屋を保存する。glbData を省略した場合はメタ情報・編集状態のみ更新する */
export async function saveRoom(record: RoomRecord, glbData?: Blob): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['rooms', 'glbs'], 'readwrite')
  await Promise.all([
    tx.objectStore('rooms').put(record),
    glbData ? tx.objectStore('glbs').put(glbData, record.id) : Promise.resolve(),
    tx.done,
  ])
}

export async function renameRoom(id: string, name: string): Promise<void> {
  const db = await getDB()
  const record = await db.get('rooms', id)
  if (!record) return
  await db.put('rooms', { ...record, name, updatedAt: new Date().toISOString() })
}

export async function deleteRoom(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['rooms', 'glbs'], 'readwrite')
  await Promise.all([tx.objectStore('rooms').delete(id), tx.objectStore('glbs').delete(id), tx.done])
}
