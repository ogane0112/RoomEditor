import { useEffect, useRef, useState } from 'react'
import { releaseModels, type ModelProgress } from '../lib/ai'
import { estimateDepth } from '../lib/depth'
import { detectObjects } from '../lib/detect'
import { openNewRoom } from '../lib/rooms'
import { estimateRoomLayout, gridSize } from '../lib/roomLayout'
import { buildRoomScene, disposeScene, exportGLB } from '../three/roomScene'

/** 推論に使う画像の長辺(px) */
const MAX_IMAGE_SIZE = 1280

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; message: string; ratio?: number }
  | { kind: 'error'; message: string }

async function loadImage(file: File): Promise<HTMLCanvasElement> {
  // スマホ写真の向き(EXIF)を反映して読み込み、扱いやすい大きさに縮小する
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

/** 推定用の格子と同じ大きさに縮めた画像の画素(床・壁・家具の色を拾う) */
function sampleColors(image: HTMLCanvasElement) {
  const { gw, gh } = gridSize(image)
  const small = document.createElement('canvas')
  small.width = gw
  small.height = gh
  const ctx = small.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0, gw, gh)
  return ctx.getImageData(0, 0, gw, gh).data
}

function progressMessage(model: string, p: ModelProgress): { message: string; ratio?: number } {
  if (p.stage === 'download') {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
    return {
      message: `${model}のAIモデルをダウンロード中… ${mb(p.loaded)} / ${mb(p.total)} MB(初回のみ)`,
      ratio: p.total ? p.loaded / p.total : undefined,
    }
  }
  return { message: `${model}のAIモデルを準備中…` }
}

const nextFrame = () => new Promise((r) => setTimeout(r, 30))

export function PhotoScanDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [focalLength, setFocalLength] = useState(26)
  const [cameraHeight, setCameraHeight] = useState(1.4)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const working = status.kind === 'working'

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    if (!picked.type.startsWith('image/')) {
      setStatus({ kind: 'error', message: '画像ファイルを選んでください' })
      return
    }
    setFile(picked)
    setStatus({ kind: 'idle' })
  }

  const run = async () => {
    if (!file) return
    try {
      setStatus({ kind: 'working', message: '写真を読み込み中…' })
      const image = await loadImage(file)

      const detections = await detectObjects(image, (p) => setStatus({ kind: 'working', ...progressMessage('家具検出', p) }))
      setStatus({ kind: 'working', message: '奥行きを推定中…' })
      const depth = await estimateDepth(image, (p) => setStatus({ kind: 'working', ...progressMessage('奥行き推定', p) }))

      setStatus({ kind: 'working', message: '部屋の形と家具の配置を計算中…' })
      await nextFrame()
      const layout = estimateRoomLayout(depth, image, detections, sampleColors(image), {
        focalLength35mm: focalLength,
        cameraHeight,
      })
      const scene = buildRoomScene(layout)
      const glb = await exportGLB(scene)
      disposeScene(scene)
      // AIモデルのメモリを空けてから3D表示に移る(スマホでメモリ不足になり表示されないのを防ぐ)
      await releaseModels()

      const stamp = new Date().toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      openNewRoom(glb, `写真から作った部屋 ${stamp.replace(/\//g, '-')}.glb`)
    } catch (e) {
      console.error(e)
      setStatus({ kind: 'error', message: `3D化に失敗しました: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => !working && onClose()}>
      <div
        role="dialog"
        aria-label="写真から3D化"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-neutral-700 bg-neutral-800 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-sm text-neutral-200 shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">写真から3D化</h2>
          <button className="text-neutral-400 hover:text-white disabled:opacity-40" onClick={onClose} disabled={working} aria-label="閉じる">
            ✕
          </button>
        </div>
        <p className="mb-4 text-neutral-400">
          部屋の写真1枚から、床・壁と家具(ソファ・椅子・テーブル・ベッド・テレビ・観葉植物など)を見つけて、シンプルな3Dモデルの部屋を作ります。
          色は写真から拾います。見落としや位置のずれは、あとでエディタで直せます。
        </p>

        <div className="mb-4 flex gap-2">
          <button className="btn flex-1 justify-center py-2" onClick={() => cameraInput.current?.click()} disabled={working}>
            カメラで撮影
          </button>
          <button className="btn flex-1 justify-center py-2" onClick={() => libraryInput.current?.click()} disabled={working}>
            写真を選ぶ
          </button>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
          <input ref={libraryInput} type="file" accept="image/*" className="hidden" onChange={pick} aria-label="写真ファイル" />
        </div>

        {previewUrl && (
          <>
            <img src={previewUrl} alt="選んだ写真" className="mb-4 max-h-56 w-full rounded object-contain" />

            <details className="mb-4 rounded border border-neutral-700 px-3 py-2">
              <summary className="cursor-pointer text-neutral-300">詳細設定</summary>
              <label className="mt-3 block">
                <span className="flex justify-between text-neutral-400">
                  <span>撮影した高さ</span>
                  <span className="font-mono text-neutral-200">{cameraHeight.toFixed(1)} m</span>
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.1}
                  value={cameraHeight}
                  onChange={(e) => setCameraHeight(Number(e.target.value))}
                  className="w-full accent-sky-500"
                  disabled={working}
                />
                <span className="text-xs text-neutral-500">部屋の大きさの基準になります(立って構えると約1.4m、座ると約1m)</span>
              </label>
              <label className="mt-3 block">
                <span className="flex justify-between text-neutral-400">
                  <span>焦点距離(35mm換算)</span>
                  <span className="font-mono text-neutral-200">{focalLength} mm</span>
                </span>
                <input
                  type="range"
                  min={13}
                  max={77}
                  step={1}
                  value={focalLength}
                  onChange={(e) => setFocalLength(Number(e.target.value))}
                  className="w-full accent-sky-500"
                  disabled={working}
                />
                <span className="text-xs text-neutral-500">スマホの通常カメラは約24〜26mm、超広角は約13mmです</span>
              </label>
            </details>

            <button className="btn btn-primary w-full justify-center py-2 text-base" onClick={run} disabled={working}>
              {working ? '処理中…' : '3D化する'}
            </button>
          </>
        )}

        {status.kind === 'working' && (
          <div className="mt-4" aria-live="polite">
            <p className="mb-2 text-neutral-300">{status.message}</p>
            <div className="h-1.5 overflow-hidden rounded bg-neutral-700">
              <div
                className={`h-full bg-sky-500 transition-all ${status.ratio === undefined ? 'w-1/3 animate-pulse' : ''}`}
                style={status.ratio === undefined ? undefined : { width: `${Math.round(status.ratio * 100)}%` }}
              />
            </div>
          </div>
        )}
        {status.kind === 'error' && <p className="mt-4 rounded bg-red-900/40 px-3 py-2 text-red-200">{status.message}</p>}

        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          写真は端末の外に送信されず、AIの処理もブラウザ内で行います。初回のみAIモデル(家具検出・奥行き推定の計約50MB、Hugging Faceから)をダウンロードします。
          部屋全体が写るように、少し離れて横向きで撮るのがおすすめです。
        </p>
      </div>
    </div>
  )
}
