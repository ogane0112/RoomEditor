import { useEffect, useRef, useState } from 'react'
import { estimateDepth, type DepthProgress } from '../lib/depth'
import { openNewRoom } from '../lib/rooms'
import { buildPhotoMeshes, exportPhotoMeshesGLB } from '../three/photoMesh'

/** 推論・テクスチャに使う画像の長辺(px) */
const MAX_IMAGE_SIZE = 1600

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

function progressMessage(p: DepthProgress): { message: string; ratio?: number } {
  switch (p.stage) {
    case 'download': {
      const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
      return {
        message: `AIモデルをダウンロード中… ${mb(p.loaded)} / ${mb(p.total)} MB(初回のみ)`,
        ratio: p.total ? p.loaded / p.total : undefined,
      }
    }
    case 'init':
      return { message: 'AIモデルを準備中…' }
    case 'infer':
      return { message: '写真から奥行きを推定中…(数秒〜数十秒かかります)' }
  }
}

export function PhotoScanDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [depthRange, setDepthRange] = useState(5)
  const [focalLength, setFocalLength] = useState(26)
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
      const depth = await estimateDepth(image, (p) => setStatus({ kind: 'working', ...progressMessage(p) }))
      setStatus({ kind: 'working', message: '3Dモデルを作成中…' })
      // 重い処理の前に描画を1回挟んでメッセージを表示させる
      await new Promise((r) => setTimeout(r, 30))
      const group = buildPhotoMeshes(image, depth, { focalLength35mm: focalLength, near: 0.5, far: depthRange })
      const glb = await exportPhotoMeshesGLB(group)
      const stamp = new Date().toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      openNewRoom(glb, `写真スキャン ${stamp.replace(/\//g, '-')}.glb`)
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
          部屋の写真1枚から、AIで奥行きを推定して立体にします。手前の家具などは自動で別パーツに分かれ、動かしたり色を変えたりできます。
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

            <label className="mb-3 block">
              <span className="flex justify-between text-neutral-400">
                <span>部屋の奥行き(最も遠い所までの距離)</span>
                <span className="font-mono text-neutral-200">{depthRange} m</span>
              </span>
              <input
                type="range"
                min={2}
                max={15}
                step={0.5}
                value={depthRange}
                onChange={(e) => setDepthRange(Number(e.target.value))}
                className="w-full accent-sky-500"
                disabled={working}
              />
            </label>
            <label className="mb-4 block">
              <span className="flex justify-between text-neutral-400">
                <span>焦点距離(35mm換算・広角ほど小さい)</span>
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
          写真は端末の外に送信されず、AIの処理もブラウザ内で行います。初回のみAIモデル(約25〜50MB、Hugging Faceから)をダウンロードします。
          1方向から見た立体なので、裏側や隠れていた部分はありません。
        </p>
      </div>
    </div>
  )
}
